import { describe, it, expect } from 'vitest';
import { getDefaultVolumeByExperience } from '../lib/coaching/athlete-defaults';

describe('getDefaultVolumeByExperience', () => {
    it('returns 30 for beginners', () => {
        expect(getDefaultVolumeByExperience('beginner')).toBe(30);
    });

    it('returns 50 for intermediate (default when experience is unknown)', () => {
        expect(getDefaultVolumeByExperience('intermediate')).toBe(50);
        expect(getDefaultVolumeByExperience(undefined)).toBe(50);
        expect(getDefaultVolumeByExperience('something-else')).toBe(50);
    });

    it('returns 80 for elite', () => {
        expect(getDefaultVolumeByExperience('elite')).toBe(80);
    });
});
