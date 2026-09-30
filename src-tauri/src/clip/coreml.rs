//! A thin wrapper around a compiled Core ML model (`.mlmodelc`) with one
//! fixed-shape input and one float output.

use std::{ffi::c_void, path::Path, ptr::NonNull};

use objc2::{AllocAnyThread, rc::Retained, runtime::AnyObject, runtime::ProtocolObject};
use objc2_core_ml::{
    MLComputeUnits, MLDictionaryFeatureProvider, MLFeatureProvider, MLFeatureValue, MLModel,
    MLModelConfiguration, MLMultiArray, MLMultiArrayDataType,
};
use objc2_foundation::{NSArray, NSDictionary, NSNumber, NSString, NSURL};

/// A model input buffer, laid out row-major in the model's input shape
pub enum Input<'a> {
    F32(&'a mut [f32]),
    I32(&'a mut [i32]),
}

pub struct CoreMlModel {
    model: Retained<MLModel>,
}

// SAFETY: MLModel isn't marked Send by objc2, but Core ML allows using a model
// from any thread. Eye See only ever uses a model from one thread at a time
// (the engine sits behind a mutex).
unsafe impl Send for CoreMlModel {}

fn numbers(values: &[usize]) -> Retained<NSArray<NSNumber>> {
    let values: Vec<Retained<NSNumber>> = values.iter().map(|&v| NSNumber::new_usize(v)).collect();
    NSArray::from_retained_slice(&values)
}

fn row_major_strides(shape: &[usize]) -> Vec<usize> {
    let mut strides = vec![1; shape.len()];
    for i in (0..shape.len().saturating_sub(1)).rev() {
        strides[i] = strides[i + 1] * shape[i + 1];
    }
    strides
}

fn f16_to_f32(bits: u16) -> f32 {
    let sign = if bits & 0x8000 != 0 { -1.0 } else { 1.0 };
    let exponent = i32::from((bits >> 10) & 0x1f);
    let fraction = f32::from(bits & 0x3ff);
    sign * match exponent {
        0 => fraction * 2f32.powi(-24),
        31 if fraction == 0.0 => f32::INFINITY,
        31 => f32::NAN,
        _ => (1.0 + fraction / 1024.0) * 2f32.powi(exponent - 15),
    }
}

impl CoreMlModel {
    /// Loads a compiled model to run on the CPU and GPU. The Neural Engine is
    /// left out: it was much slower to load in the spike.
    pub fn load(path: &Path) -> Result<Self, String> {
        let config = unsafe { MLModelConfiguration::new() };
        unsafe { config.setComputeUnits(MLComputeUnits::CPUAndGPU) };
        let url = NSURL::fileURLWithPath(&NSString::from_str(&path.to_string_lossy()));
        let model = unsafe { MLModel::modelWithContentsOfURL_configuration_error(&url, &config) }
            .map_err(|e| {
            format!(
                "Failed to load the Core ML model \"{}\": {e}",
                path.display()
            )
        })?;
        Ok(Self { model })
    }

    /// Runs the model on `input` (in the model's fixed input `shape`) and
    /// returns the named output's values as f32.
    pub fn predict(
        &self,
        input_name: &str,
        shape: &[usize],
        input: Input<'_>,
        output_name: &str,
    ) -> Result<Vec<f32>, String> {
        let (pointer, data_type, len) = match input {
            Input::F32(data) => (
                data.as_mut_ptr().cast::<c_void>(),
                MLMultiArrayDataType::Float32,
                data.len(),
            ),
            Input::I32(data) => (
                data.as_mut_ptr().cast::<c_void>(),
                MLMultiArrayDataType::Int32,
                data.len(),
            ),
        };
        if len != shape.iter().product::<usize>() {
            return Err(format!(
                "Input of {len} values doesn't fit the shape {shape:?}"
            ));
        }
        let pointer = NonNull::new(pointer).ok_or("Empty input")?;

        objc2::rc::autoreleasepool(|_| unsafe {
            // Wraps the caller's buffer without copying; it outlives the prediction
            let array = MLMultiArray::initWithDataPointer_shape_dataType_strides_deallocator_error(
                MLMultiArray::alloc(),
                pointer,
                &numbers(shape),
                data_type,
                &numbers(&row_major_strides(shape)),
                None,
            )
            .map_err(|e| format!("Failed to wrap the model input: {e}"))?;
            let value = MLFeatureValue::featureValueWithMultiArray(&array);
            let value: &AnyObject = &value;
            let name = NSString::from_str(input_name);
            let features = NSDictionary::<NSString, AnyObject>::from_slices(&[&*name], &[value]);
            let provider = MLDictionaryFeatureProvider::initWithDictionary_error(
                MLDictionaryFeatureProvider::alloc(),
                &features,
            )
            .map_err(|e| format!("Failed to prepare the model input: {e}"))?;

            let output = self
                .model
                .predictionFromFeatures_error(ProtocolObject::from_ref(&*provider))
                .map_err(|e| format!("Core ML prediction failed: {e}"))?;
            let array = output
                .featureValueForName(&NSString::from_str(output_name))
                .and_then(|value| value.multiArrayValue())
                .ok_or_else(|| format!("The model has no \"{output_name}\" output"))?;

            let count = array.count() as usize;
            let output_shape: Vec<usize> = array.shape().iter().map(|n| n.as_usize()).collect();
            let strides: Vec<usize> = array.strides().iter().map(|n| n.as_usize()).collect();
            if strides != row_major_strides(&output_shape) {
                return Err(format!(
                    "Unexpected output layout: shape {output_shape:?}, strides {strides:?}"
                ));
            }
            #[allow(deprecated)]
            let raw = array.dataPointer().as_ptr();
            match array.dataType() {
                MLMultiArrayDataType::Float32 => {
                    Ok(std::slice::from_raw_parts(raw.cast::<f32>(), count).to_vec())
                }
                MLMultiArrayDataType::Float16 => {
                    Ok(std::slice::from_raw_parts(raw.cast::<u16>(), count)
                        .iter()
                        .map(|&bits| f16_to_f32(bits))
                        .collect())
                }
                other => Err(format!("Unexpected output type {other:?}")),
            }
        })
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn computes_row_major_strides() {
        assert_eq!(
            row_major_strides(&[32, 3, 224, 224]),
            [150528, 50176, 224, 1]
        );
        assert_eq!(row_major_strides(&[1, 77]), [77, 1]);
    }

    #[test]
    fn converts_half_floats() {
        assert_eq!(f16_to_f32(0x3C00), 1.0);
        assert_eq!(f16_to_f32(0xC000), -2.0);
        assert_eq!(f16_to_f32(0x3555), 0.33325195);
        assert_eq!(f16_to_f32(0x0001), 2f32.powi(-24));
        assert_eq!(f16_to_f32(0x7C00), f32::INFINITY);
        assert!(f16_to_f32(0x7E00).is_nan());
    }
}
