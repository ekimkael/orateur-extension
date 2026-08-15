// Type shim for onnxruntime-web — the package's exports map omits "types",
// so TypeScript cannot resolve it automatically with moduleResolution: bundler.
declare module "onnxruntime-web" {
  export * from "onnxruntime-common"
}
