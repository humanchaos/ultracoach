// Lifelog module exports
// Two-pass architecture: interpret user input → extract readiness → feed to coach

export {
    interpretLifelog,
    formatReadinessForContext,
    hasBlockingRiskFlags,
    type LifelogInterpretation,
    type ReadinessProfile,
} from './interpreter';
