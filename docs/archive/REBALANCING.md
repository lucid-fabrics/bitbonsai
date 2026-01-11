# Job Rebalancing Guide

## Overview

BitBonsai automatically distributes encoding jobs across your cluster nodes to maximize throughput. When one node gets overloaded while another sits idle, the **rebalancing algorithm** redistributes queued jobs to keep all nodes working efficiently.

## How It Works

### The Algorithm in Plain English

1. **Check Your Cluster**
   - System looks at all ONLINE nodes on your local network
   - Only moves jobs between LOCAL nodes (nodes with shared storage via NFS)
   - Ignores REMOTE nodes (moving jobs over slow internet would hurt performance)

2. **Calculate Load**
   - Load = (Queued Jobs ÷ Max Workers) × 100
   - Example: 20 queued jobs with 4 workers = 500% load

3. **Classify Nodes**
   - **OVERLOADED**: Load > 80% (needs help)
   - **BALANCED**: Load 50-80% (healthy)
   - **UNDERUTILIZED**: Load < 50% (has capacity)

4. **Decide if Rebalancing is Needed**
   - Only triggers when you have BOTH:
     - At least one OVERLOADED node (>80%)
     - At least one UNDERUTILIZED node (<50%)
   - If all nodes are between 50-80%, system considers them balanced (no action)

5. **Move Jobs**
   - Moves up to 5 jobs from each overloaded node
   - Distributes jobs evenly across underutilized nodes
   - Workers automatically pick up the reassigned jobs

## Example Scenarios

### ✅ Scenario A: Rebalancing WILL Happen

```
Main Node:  92 queued jobs ÷ 4 workers = 2300% load (OVERLOADED)
Child Node: 2 queued jobs  ÷ 5 workers = 40% load   (UNDERUTILIZED)
```

**Result**: Moves 5 jobs from Main to Child

### ❌ Scenario B: Rebalancing WILL NOT Happen

```
Main Node:  20 queued jobs ÷ 4 workers = 500% load (OVERLOADED)
Child Node: 15 queued jobs ÷ 5 workers = 300% load (OVERLOADED)
```

**Reason**: Both nodes overloaded, no underutilized target available

### ❌ Scenario C: Rebalancing WILL NOT Happen

```
Main Node:  3 queued jobs ÷ 4 workers = 75% load (BALANCED)
Child Node: 2 queued jobs ÷ 5 workers = 40% load (UNDERUTILIZED)
```

**Reason**: Main node not overloaded (75% < 80% threshold)

## When to Trigger Rebalancing

### Automatic (Recommended)

Enable periodic rebalancing via cron job (if available in your version). This runs every X minutes and automatically redistributes jobs as needed.

### Manual

Use the API endpoint when you notice uneven distribution:

```bash
curl -X POST http://YOUR_IP:3100/api/v1/queue/rebalance
```

**When to manually rebalance:**
- After adding many jobs to one node's library
- After adding a new node to your cluster
- When you see one node overloaded while another sits idle

## Troubleshooting

### "No rebalancing needed" but distribution looks uneven

If rebalance returns 0 jobs moved but you see imbalance, check:

1. **Are both nodes LOCAL?**
   - Check node settings → Network Location
   - REMOTE nodes are excluded from rebalancing

2. **Check the thresholds**
   - Overloaded threshold: >80%
   - Underutilized threshold: <50%
   - If both nodes are between 50-80%, rebalance won't trigger

3. **Both nodes >50% load?**
   - Example: Main at 2300%, Child at 220%
   - Both are >50%, so child not considered "underutilized"
   - Thresholds are conservative to prevent over-rebalancing

### Manual Intervention for Severe Imbalances

If you have a severe imbalance (e.g., 92 vs 11 queue) that rebalancing can't fix due to thresholds:

**Option 1: Direct SQL (Advanced)**

```sql
UPDATE jobs
SET "nodeId" = 'CHILD_NODE_ID'
WHERE "nodeId" = 'MAIN_NODE_ID'
  AND stage = 'QUEUED'
LIMIT 20;
```

Replace `CHILD_NODE_ID` and `MAIN_NODE_ID` with actual node IDs from your database.

**Option 2: Adjust Thresholds (Developer)**

Edit `apps/backend/src/queue/services/job-router.service.ts`:
- Line 294: Change `n.load > 80` to higher value (e.g., `> 100`)
- Line 295: Change `n.load < 50` to higher value (e.g., `< 100`)

## Important Limitations

| Limitation | Why? | Impact |
|------------|------|--------|
| Only moves QUEUED jobs | Moving ENCODING jobs would interrupt work | Active jobs stay put |
| Only rebalances LOCAL nodes | Network latency hurts performance | REMOTE nodes excluded |
| 5 jobs per batch | Prevents overwhelming target nodes | Large imbalances need multiple runs |
| Conservative thresholds | Avoids constant shuffling | May miss some imbalances |

## Best Practices

1. **Let the system work** - Thresholds are conservative by design to prevent constant job shuffling
2. **Monitor trends** - If one node is consistently overloaded, consider:
   - Adding more workers to that node
   - Rebalancing library locations
   - Adjusting job routing logic
3. **Manual rebalance after bulk adds** - If you add 100 jobs to one node's library, manually trigger rebalance
4. **Don't over-rebalance** - Running rebalance every minute doesn't help; jobs need time to complete

## Technical Details

For developers and advanced users:

- **Algorithm**: Threshold-based with round-robin distribution
- **Code**: `apps/backend/src/queue/services/job-router.service.ts` (line 253)
- **API**: `POST /api/v1/queue/rebalance`
- **Thresholds**:
  - Overloaded: `> 80%` (line 294)
  - Underutilized: `< 50%` (line 295)
- **Batch size**: 5 jobs/node (line 315)
- **Filter**: Only `QUEUED` stage, `LOCAL` network, `ONLINE` status

## FAQ

**Q: Why doesn't rebalancing move jobs from my 2300% loaded node?**

A: The target node must be <50% load. If your target has >50% load, rebalancing won't trigger. This is by design to avoid constant shuffling.

**Q: Can I force rebalancing to be more aggressive?**

A: Yes, adjust the thresholds in the code (see "Adjust Thresholds" above), or use manual SQL to move jobs directly.

**Q: Why are REMOTE nodes excluded?**

A: Moving jobs over slow internet/VPN connections would waste more time than encoding locally. Only LOCAL nodes (with fast NFS shared storage) participate in rebalancing.

**Q: What happens to jobs being encoded?**

A: ENCODING jobs never move. Only QUEUED jobs are redistributed. Once a job starts encoding, it stays on that node until completion.

**Q: How often should I run rebalancing?**

A: Automatic periodic rebalancing every 10-15 minutes is ideal. Manual rebalancing should only be needed after major changes (bulk job adds, new nodes, etc.).

---

**Last Updated**: 2026-01-01
**Version**: 1.0
