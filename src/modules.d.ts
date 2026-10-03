// Module rules in wrangler.jsonc: text, binary data and compiled WASM imports.
declare module '*.html' { const text: string; export default text; }
declare module '*.txt' { const text: string; export default text; }
declare module '*.ttf' { const data: ArrayBuffer; export default data; }
declare module '*.wasm' { const module: WebAssembly.Module; export default module; }
