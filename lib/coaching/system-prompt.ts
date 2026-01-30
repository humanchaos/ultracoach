// UltraCoach System Prompt
// Exports both v4 (backup) and v5 (active)

export { SYSTEM_PROMPT_V4 } from './system-prompt-v4';
export { SYSTEM_PROMPT_V5 } from './system-prompt-v5';

// Default export is v5 (can be overridden via env)
export { SYSTEM_PROMPT_V5 as SYSTEM_PROMPT } from './system-prompt-v5';
