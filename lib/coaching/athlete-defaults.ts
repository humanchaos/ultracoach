/**
 * Returns a safe weekly volume cap based on experience level.
 * Used when the athlete has no saved max_weekly_volume preference.
 */
export function getDefaultVolumeByExperience(experience?: string): number {
    switch (experience) {
        case 'beginner':     return 30;
        case 'intermediate': return 50;
        case 'advanced':     return 70;
        case 'elite':        return 80;
        default:             return 50;  // unknown → conservative
    }
}
