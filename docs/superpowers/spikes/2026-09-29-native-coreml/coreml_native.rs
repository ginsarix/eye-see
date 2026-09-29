//! Runs the coremltools-converted CLIP vision model through Core ML directly.

use std::{ffi::c_void, ptr::NonNull};

use anyhow::{anyhow, bail, Result};
use objc2::{rc::Retained, runtime::AnyObject, runtime::ProtocolObject, AllocAnyThread};
use objc2_core_ml::{
    MLComputeUnits, MLDictionaryFeatureProvider, MLFeatureProvider, MLFeatureValue, MLModel,
    MLModelConfiguration, MLMultiArray, MLMultiArrayDataType,
};
use objc2_foundation::{ns_string, NSArray, NSDictionary, NSNumber, NSString, NSURL};

pub struct CoreMlVision {
    model: Retained<MLModel>,
}

fn numbers(values: &[usize]) -> Retained<NSArray<NSNumber>> {
    let values: Vec<Retained<NSNumber>> = values.iter().map(|&v| NSNumber::new_usize(v)).collect();
    NSArray::from_retained_slice(&values)
}

fn f16_to_f32(bits: u16) -> f32 {
    let sign = if bits & 0x8000 != 0 { -1.0 } else { 1.0 };
    let exp = ((bits >> 10) & 0x1f) as i32;
    let frac = (bits & 0x3ff) as f32;
    sign * match exp {
        0 => frac * 2f32.powi(-24),
        31 => f32::INFINITY,
        _ => (1.0 + frac / 1024.0) * 2f32.powi(exp - 15),
    }
}

impl CoreMlVision {
    pub fn load(path: &str, units: &str) -> Result<Self> {
        let units = match units {
            "cpu" => MLComputeUnits::CPUOnly,
            "ane" => MLComputeUnits::CPUAndNeuralEngine,
            "all" => MLComputeUnits::All,
            _ => MLComputeUnits::CPUAndGPU,
        };
        unsafe {
            let config = MLModelConfiguration::new();
            config.setComputeUnits(units);
            let url = NSURL::fileURLWithPath(&NSString::from_str(path));
            let model = MLModel::modelWithContentsOfURL_configuration_error(&url, &config)
                .map_err(|e| anyhow!("loading {path}: {e}"))?;
            Ok(Self { model })
        }
    }

    // `data` holds `batch` images as NCHW f32
    pub fn embed(&self, batch: usize, data: &mut [f32]) -> Result<Vec<Vec<f32>>> {
        objc2::rc::autoreleasepool(|_| unsafe {
            let shape = [batch, 3, 224, 224];
            let strides = [3 * 224 * 224, 224 * 224, 224, 1];
            let pointer = NonNull::new(data.as_mut_ptr().cast::<c_void>()).unwrap();
            // Wraps our buffer without copying; it outlives the prediction below
            let input = MLMultiArray::initWithDataPointer_shape_dataType_strides_deallocator_error(
                MLMultiArray::alloc(),
                pointer,
                &numbers(&shape),
                MLMultiArrayDataType::Float32,
                &numbers(&strides),
                None,
            )
            .map_err(|e| anyhow!("input array: {e}"))?;
            let value = MLFeatureValue::featureValueWithMultiArray(&input);
            let value: &AnyObject = &value;
            let features = NSDictionary::<NSString, AnyObject>::from_slices(&[ns_string!("pixel_values")], &[value]);
            let provider = MLDictionaryFeatureProvider::initWithDictionary_error(
                MLDictionaryFeatureProvider::alloc(),
                &features,
            )
            .map_err(|e| anyhow!("features: {e}"))?;

            let output = self
                .model
                .predictionFromFeatures_error(ProtocolObject::from_ref(&*provider))
                .map_err(|e| anyhow!("prediction: {e}"))?;
            let embeds = output
                .featureValueForName(ns_string!("image_embeds"))
                .and_then(|v| v.multiArrayValue())
                .ok_or_else(|| anyhow!("no image_embeds output"))?;

            let count = embeds.count() as usize;
            if count != batch * 512 {
                bail!("expected {} values, got {count}", batch * 512);
            }
            #[allow(deprecated)]
            let raw = embeds.dataPointer().as_ptr();
            let values: Vec<f32> = match embeds.dataType() {
                MLMultiArrayDataType::Float32 => std::slice::from_raw_parts(raw.cast::<f32>(), count).to_vec(),
                MLMultiArrayDataType::Float16 => std::slice::from_raw_parts(raw.cast::<u16>(), count)
                    .iter()
                    .map(|&b| f16_to_f32(b))
                    .collect(),
                other => bail!("unexpected output type {other:?}"),
            };
            Ok(values.chunks(512).map(|c| c.to_vec()).collect())
        })
    }
}
