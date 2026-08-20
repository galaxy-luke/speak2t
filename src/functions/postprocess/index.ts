/**
 * Postprocess module entry point
 */

export { postprocess, postprocessWithReport, DEFAULT_RULES } from './punctuation';
export type { PostprocessOptions, PostprocessResult, PostprocessRule } from './types';
export { trimWhitespaceRule } from './rules/trim-whitespace';
export { cnEnSpaceRule } from './rules/cn-en-space';
export { cnDigitSpaceRule } from './rules/cn-digit-space';
export { commaNormalizeRule } from './rules/comma-normalize';
export { trailingPeriodRule } from './rules/trailing-period';
export { collapseSpacesRule } from './rules/collapse-spaces';
