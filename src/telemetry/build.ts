export const buildInfo = __BUILD_INFO__

/** Short SHA, with `*` when built from a dirty working tree. */
export const buildLabel = `${buildInfo.sha}${buildInfo.dirty ? '*' : ''}`
