/**
 * Article UI host shell. The browser half is loaded through package.json
 * `dsh.client`; the host half exists only so Loader can compose the package.
 */

/** Host plugin body — no host-side behavior for this UI surface. */
export function apply(): void {}
