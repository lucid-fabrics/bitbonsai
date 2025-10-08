# Agent Workflow Chains

Pre-built multi-agent workflows for common development tasks.

## Available Workflows

### complete-feature.yml
**Purpose:** End-to-end feature implementation
**Agents:** 8 agents (fullstack, test-engineer, playwright x2, docs, reviewer, debugger)
**Duration:** ~2-4 hours
**Use:** `"Implement complete {{feature_name}} feature with all tests and docs"`

### bug-fix.yml
**Purpose:** Systematic bug resolution
**Agents:** 2 agents (debugger, test-engineer)
**Duration:** ~30 minutes
**Use:** `"Fix bug: {{bug_description}}"`

### performance-audit.yml
**Purpose:** Performance profiling and optimization
**Agents:** 2 agents (performance-optimizer, documentation-writer)
**Duration:** ~1-2 hours
**Use:** `"Optimize performance of {{feature_name}}"`

### security-scan.yml
**Purpose:** Security vulnerability scanning and fixes
**Agents:** 3 agents (security-auditor, debugger, documentation-writer)
**Duration:** ~1 hour
**Use:** `"Run security audit and fix vulnerabilities"`

## How to Use

Workflows are YAML definitions that orchestrate multiple agents.
Currently manual execution (future: automated orchestration).

**Example:**
1. User: "Implement job filtering feature"
2. Main agent: Executes `complete-feature.yml` workflow
3. Agents run sequentially with outputs passing between them
4. Final result: Fully implemented, tested, documented feature

## Future Enhancement

Automated workflow orchestration with the `orchestrator` agent (Phase 3).
