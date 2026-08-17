/**
 * CSS Modules type declarations (tsdown compiles `*.module.css` to a class-map
 * default export; this mirror keeps `tsc --noEmit` honest). Scoped to the
 * annotate module's needs — one wildcard declaration, no runtime footprint.
 */
declare module '*.module.css' {
  const classes: Record<string, string>
  export default classes
}
