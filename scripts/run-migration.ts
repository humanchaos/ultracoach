/**
 * Run database migrations
 * Usage: npx tsx scripts/run-migration.ts
 */

import { config } from 'dotenv';
import { resolve } from 'path';

// Load environment variables
config({ path: resolve(__dirname, '../.env.local') });

import { sql } from '@vercel/postgres';

async function runMigration() {
    console.log('🔄 Running migration 008_plan_versioning.sql...\n');

    try {
        // Add plan_version column
        console.log('Adding plan_version column...');
        await sql`ALTER TABLE training_blocks ADD COLUMN IF NOT EXISTS plan_version INT DEFAULT 1`;
        console.log('  ✓ plan_version column added');

        // Create plan_changelog table
        console.log('Creating plan_changelog table...');
        await sql`
            CREATE TABLE IF NOT EXISTS plan_changelog (
                id SERIAL PRIMARY KEY,
                block_id INT REFERENCES training_blocks(id) ON DELETE CASCADE,
                version INT NOT NULL,
                change_type VARCHAR(50) NOT NULL,
                reason TEXT NOT NULL,
                volume_change_pct NUMERIC(5,2),
                old_plan_snapshot JSONB,
                week_number INT,
                created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
            )
        `;
        console.log('  ✓ plan_changelog table created');

        // Create indexes
        console.log('Creating indexes...');
        await sql`CREATE INDEX IF NOT EXISTS idx_plan_changelog_block ON plan_changelog(block_id)`;
        await sql`CREATE INDEX IF NOT EXISTS idx_plan_changelog_created ON plan_changelog(created_at DESC)`;
        console.log('  ✓ Indexes created');

        console.log('\n✅ Migration complete!');
        process.exit(0);
    } catch (error) {
        console.error('\n❌ Migration failed:', error);
        process.exit(1);
    }
}

runMigration();
