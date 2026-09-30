//! CLIP image preprocessing, matching what transformers.js did in the webview:
//! the shortest edge resized to 224 (Lanczos3), a centered 224×224 crop, then
//! each channel scaled to 0..1 and normalized with CLIP's mean and std.

use std::path::Path;

use image::{DynamicImage, ImageDecoder, ImageReader, imageops::FilterType};

pub const IMAGE_SIZE: u32 = 224;
/// Floats per preprocessed image: 3 channels × 224 × 224, channel-major (CHW)
pub const PIXELS_PER_IMAGE: usize = 3 * (IMAGE_SIZE * IMAGE_SIZE) as usize;
pub const MEAN: [f32; 3] = [0.48145466, 0.4578275, 0.40821073];
pub const STD: [f32; 3] = [0.26862954, 0.26130258, 0.27577711];

/// Decodes and preprocesses one image file.
pub fn preprocess(path: &Path) -> Result<Vec<f32>, String> {
    Ok(to_pixels(&decode(path)?))
}

/// Decodes an image by its contents rather than its extension, and applies its
/// EXIF orientation the way the webview did, so phone photos aren't sideways.
pub fn decode(path: &Path) -> Result<DynamicImage, String> {
    let fail =
        |error: &dyn std::fmt::Display| format!("Failed to decode \"{}\": {error}", path.display());
    let mut decoder = ImageReader::open(path)
        .map_err(|e| fail(&e))?
        .with_guessed_format()
        .map_err(|e| fail(&e))?
        .into_decoder()
        .map_err(|e| fail(&e))?;
    let orientation = decoder.orientation().map_err(|e| fail(&e))?;
    let mut image = DynamicImage::from_decoder(decoder).map_err(|e| fail(&e))?;
    image.apply_orientation(orientation);
    Ok(image)
}

/// The size an image is resized to before cropping: the shortest edge becomes
/// 224, and the other side is scaled with transformers.js's rounding (to two
/// decimals, then down).
pub fn resized_size(width: u32, height: u32) -> (u32, u32) {
    let scale = f64::from(IMAGE_SIZE) / f64::from(width.min(height));
    let size = |side: u32| ((f64::from(side) * scale * 100.0).round() / 100.0).floor() as u32;
    (size(width).max(IMAGE_SIZE), size(height).max(IMAGE_SIZE))
}

/// Resizes, center-crops and normalizes an image into CHW floats.
pub fn to_pixels(image: &DynamicImage) -> Vec<f32> {
    let rgb = image.to_rgb8();
    let (width, height) = resized_size(rgb.width(), rgb.height());
    let resized = image::imageops::resize(&rgb, width, height, FilterType::Lanczos3);
    let (left, top) = ((width - IMAGE_SIZE) / 2, (height - IMAGE_SIZE) / 2);
    let plane = (IMAGE_SIZE * IMAGE_SIZE) as usize;

    let mut pixels = vec![0f32; PIXELS_PER_IMAGE];
    for y in 0..IMAGE_SIZE {
        for x in 0..IMAGE_SIZE {
            let pixel = resized.get_pixel(left + x, top + y);
            let index = (y * IMAGE_SIZE + x) as usize;
            for channel in 0..3 {
                pixels[channel * plane + index] =
                    (f32::from(pixel[channel]) / 255.0 - MEAN[channel]) / STD[channel];
            }
        }
    }
    pixels
}

#[cfg(test)]
mod tests {
    use std::io::Cursor;

    use image::{ImageBuffer, ImageFormat, Luma, Rgb, RgbImage};

    use super::*;
    use crate::test_support::TempDir;

    fn normalized(value: u8, channel: usize) -> f32 {
        (f32::from(value) / 255.0 - MEAN[channel]) / STD[channel]
    }

    fn at(pixels: &[f32], channel: usize, x: u32, y: u32) -> f32 {
        pixels[channel * (IMAGE_SIZE * IMAGE_SIZE) as usize + (y * IMAGE_SIZE + x) as usize]
    }

    #[test]
    fn rounds_sizes_like_transformers_js() {
        assert_eq!(resized_size(940, 650), (323, 224));
        assert_eq!(resized_size(650, 940), (224, 323));
        assert_eq!(resized_size(224, 224), (224, 224));
        // 2799 × 224 / 2083 = 300.9966, which rounds to 301.00 before flooring
        assert_eq!(resized_size(2799, 2083), (301, 224));
        assert_eq!(resized_size(100, 50), (448, 224));
    }

    #[test]
    fn normalizes_each_channel() {
        let image = DynamicImage::ImageRgb8(RgbImage::from_pixel(300, 250, Rgb([255, 0, 128])));

        let pixels = to_pixels(&image);

        assert_eq!(pixels.len(), PIXELS_PER_IMAGE);
        for (x, y) in [(0, 0), (223, 223), (100, 50)] {
            assert!((at(&pixels, 0, x, y) - normalized(255, 0)).abs() < 1e-5);
            assert!((at(&pixels, 1, x, y) - normalized(0, 1)).abs() < 1e-5);
            assert!((at(&pixels, 2, x, y) - normalized(128, 2)).abs() < 1e-5);
        }
    }

    #[test]
    fn crops_the_center() {
        // Black on the left half, white on the right: the crop spans x = 112..336
        let image = RgbImage::from_fn(448, 224, |x, _| {
            if x < 224 {
                Rgb([0, 0, 0])
            } else {
                Rgb([255, 255, 255])
            }
        });

        let pixels = to_pixels(&DynamicImage::ImageRgb8(image));

        assert!((at(&pixels, 0, 0, 100) - normalized(0, 0)).abs() < 1e-5);
        assert!((at(&pixels, 0, 223, 100) - normalized(255, 0)).abs() < 1e-5);
    }

    #[test]
    fn decodes_by_content_not_extension() {
        let dir = TempDir::new("preprocess-content");
        let path = dir.join("actually-a-png.jpg");
        RgbImage::from_pixel(8, 8, Rgb([10, 20, 30]))
            .save_with_format(&path, ImageFormat::Png)
            .unwrap();

        assert_eq!(
            decode(&path).unwrap().to_rgb8().get_pixel(0, 0),
            &Rgb([10, 20, 30])
        );
    }

    #[test]
    fn converts_grayscale_16_bit_images_to_rgb() {
        let dir = TempDir::new("preprocess-gray16");
        let path = dir.join("gray.png");
        ImageBuffer::<Luma<u16>, _>::from_pixel(8, 8, Luma([u16::MAX]))
            .save(&path)
            .unwrap();

        let pixels = preprocess(&path).unwrap();

        assert!((at(&pixels, 2, 5, 5) - normalized(255, 2)).abs() < 1e-5);
    }

    #[test]
    fn applies_the_exif_orientation() {
        // Orientation 6 means the camera was rotated: a 40×20 photo displays as 20×40
        let dir = TempDir::new("preprocess-exif");
        let path = dir.join("rotated.jpg");
        let mut jpeg = Vec::new();
        RgbImage::new(40, 20)
            .write_to(&mut Cursor::new(&mut jpeg), ImageFormat::Jpeg)
            .unwrap();
        // An APP1 segment with a big-endian TIFF holding one IFD entry:
        // Orientation (tag 0x0112), type SHORT, count 1, value 6
        let mut app1 = vec![0xFF, 0xE1, 0x00, 0x22];
        app1.extend_from_slice(b"Exif\0\0MM\0\x2A\0\0\0\x08");
        app1.extend_from_slice(&[
            0x00, 0x01, 0x01, 0x12, 0x00, 0x03, 0x00, 0x00, 0x00, 0x01, 0x00, 0x06, 0x00, 0x00,
        ]);
        app1.extend_from_slice(&[0x00, 0x00, 0x00, 0x00]);
        jpeg.splice(2..2, app1);
        std::fs::write(&path, jpeg).unwrap();

        let image = decode(&path).unwrap();

        assert_eq!((image.width(), image.height()), (20, 40));
    }

    #[test]
    fn fails_on_a_corrupt_file() {
        let dir = TempDir::new("preprocess-corrupt");
        let path = dir.join("broken.jpg");
        std::fs::write(&path, b"not an image").unwrap();

        let error = preprocess(&path).unwrap_err();

        assert!(error.contains("broken.jpg"), "{error}");
    }
}
