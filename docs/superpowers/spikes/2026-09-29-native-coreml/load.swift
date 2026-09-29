// Times loading a compiled Core ML model directly, without ONNX Runtime.
// Usage: swift load.swift <path.mlmodelc> <cpu|gpu|ane|all>
import CoreML
import Foundation

let url = URL(fileURLWithPath: CommandLine.arguments[1])
let units: [String: MLComputeUnits] = ["cpu": .cpuOnly, "gpu": .cpuAndGPU, "ane": .cpuAndNeuralEngine, "all": .all]
let config = MLModelConfiguration()
config.computeUnits = units[CommandLine.arguments[2]]!

let started = Date()
_ = try MLModel(contentsOf: url, configuration: config)
print(CommandLine.arguments[2], String(format: "load %.0f ms", Date().timeIntervalSince(started) * 1000))
