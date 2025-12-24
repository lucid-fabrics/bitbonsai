# BitBonsai Monitoring & Operations Guide

**Last Updated:** 2025-12-23

---

## 📊 Monitoring Stack

### PM2 Process Management

**View all processes:**
```bash
pm2 status
```

**View logs:**
```bash
pm2 logs              # All processes
pm2 logs license-api  # Specific process
pm2 logs --lines 100  # Last 100 lines
```

**Monitor in real-time:**
```bash
pm2 monit
```

**Restart services:**
```bash
pm2 restart all
pm2 restart license-api
pm2 reload all  # Zero-downtime reload
```

---

## 🐳 Docker Monitoring

### Container Status

```bash
docker-compose -f docker-compose.license.yml ps
docker-compose -f docker-compose.license.yml logs -f
docker-compose -f docker-compose.license.yml logs -f license-api
```

### Resource Usage

```bash
docker stats
docker stats bitbonsai-license-api
```

### Container Health

```bash
# Check if license-api is healthy
curl http://localhost:3000/health

# Check admin dashboard
curl http://localhost:4200

# Check website
curl http://localhost:4201
```

---

## 📈 Key Metrics to Monitor

### License API

| Metric | Endpoint | Alert Threshold |
|--------|----------|-----------------|
| Health | `GET /health` | Response time > 1s |
| Active Licenses | `GET /analytics/revenue-metrics` | Track daily |
| MRR/ARR | `GET /analytics/revenue-metrics` | Track daily |
| Churn Rate | `GET /analytics/revenue-metrics` | > 10% monthly |
| Database Connections | Postgres metrics | > 80% pool utilization |
| API Response Time | Application logs | P95 > 500ms |
| Error Rate | Application logs | > 1% |

### Database (PostgreSQL)

```bash
# Connect to license database
docker exec -it bitbonsai-license-db psql -U license_user -d license_api

# Check database size
SELECT pg_size_pretty(pg_database_size('license_api'));

# Check active connections
SELECT count(*) FROM pg_stat_activity;

# Check slow queries
SELECT query, calls, total_time, mean_time
FROM pg_stat_statements
ORDER BY mean_time DESC
LIMIT 10;
```

### System Resources

```bash
# CPU usage
top

# Memory usage
free -h

# Disk usage
df -h

# Check logs directory size
du -sh logs/
```

---

## 🚨 Alert Conditions

### Critical Alerts (Immediate Action)

1. **License API Down**
   - Health endpoint fails for > 2 minutes
   - Action: Check container logs, restart service

2. **Database Connection Failure**
   - Unable to connect to PostgreSQL
   - Action: Check database container, verify credentials

3. **Stripe Webhook Failures**
   - Webhook processing errors
   - Action: Check Stripe dashboard, verify webhook secret

4. **Disk Space Critical**
   - < 10% free space
   - Action: Clean logs, expand storage

### Warning Alerts (Monitor)

1. **High Churn Rate**
   - > 10% monthly churn
   - Action: Review customer feedback, pricing strategy

2. **Slow API Response**
   - P95 > 500ms
   - Action: Check database queries, add indexes

3. **High Error Rate**
   - > 1% of requests failing
   - Action: Review error logs, fix bugs

4. **Memory Usage High**
   - > 80% memory utilization
   - Action: Check for memory leaks, scale up

---

## 🔄 Backup & Recovery

### Database Backups

**Automated daily backups:**
```bash
# Add to crontab (runs at 2 AM daily)
0 2 * * * docker exec bitbonsai-license-db pg_dump -U license_user license_api | gzip > /backups/license-api-$(date +\%Y\%m\%d).sql.gz
```

**Manual backup:**
```bash
docker exec bitbonsai-license-db pg_dump -U license_user license_api > backup.sql
```

**Restore from backup:**
```bash
docker exec -i bitbonsai-license-db psql -U license_user license_api < backup.sql
```

**Keep backups for:**
- Daily: Last 7 days
- Weekly: Last 4 weeks
- Monthly: Last 12 months

### Configuration Backups

```bash
# Backup .env file (encrypted storage recommended)
cp .env .env.backup.$(date +%Y%m%d)

# Backup docker-compose files
tar czf docker-compose-backup.tar.gz docker-compose*.yml
```

---

## 🔧 Maintenance Tasks

### Daily

- ✅ Check PM2/Docker process status
- ✅ Review error logs for anomalies
- ✅ Verify backup completion

### Weekly

- ✅ Review MRR/ARR trends
- ✅ Check churn rate
- ✅ Analyze slow queries
- ✅ Review disk usage
- ✅ Test backup restoration

### Monthly

- ✅ Rotate secrets (if due)
- ✅ Update dependencies
- ✅ Review security logs
- ✅ Capacity planning review
- ✅ Clean old logs (> 30 days)

### Quarterly

- ✅ Full security audit
- ✅ Disaster recovery drill
- ✅ Performance optimization review
- ✅ Update documentation

---

## 🔍 Troubleshooting

### License API Won't Start

**Check logs:**
```bash
docker logs bitbonsai-license-api
pm2 logs license-api
```

**Common issues:**
1. Missing environment variables → Check .env file
2. Database connection failed → Verify LICENSE_DATABASE_URL
3. Port already in use → Check `lsof -i :3000`
4. Migration failed → Run `npx prisma migrate deploy` manually

### High Memory Usage

**Identify memory hog:**
```bash
docker stats
pm2 list
```

**Solutions:**
1. Restart service: `pm2 restart license-api`
2. Check for memory leaks in code
3. Increase `max_memory_restart` in PM2 config
4. Scale horizontally (add more instances)

### Slow Queries

**Enable PostgreSQL query logging:**
```sql
ALTER SYSTEM SET log_min_duration_statement = 1000;  -- Log queries > 1s
SELECT pg_reload_conf();
```

**View slow queries:**
```bash
docker exec bitbonsai-license-db tail -f /var/lib/postgresql/data/log/postgresql.log
```

**Solutions:**
1. Add indexes to frequently queried columns
2. Optimize N+1 queries
3. Add caching layer (Redis)
4. Implement query result pagination

### Stripe Webhook Issues

**Check webhook logs:**
```bash
pm2 logs license-api | grep webhook
```

**Verify webhook signature:**
- Check STRIPE_WEBHOOK_SECRET in .env
- Compare with Stripe Dashboard → Developers → Webhooks

**Test webhook locally:**
```bash
stripe listen --forward-to localhost:3000/webhooks/stripe
```

---

## 📞 Escalation Contacts

| Issue Type | Contact | Response Time |
|------------|---------|---------------|
| Critical Outage | On-call engineer | < 15 minutes |
| Database Issues | DBA | < 30 minutes |
| Security Incident | Security team | < 10 minutes |
| Payment Issues | Finance team | < 1 hour |

---

## 📚 Additional Resources

- **Stripe Webhook Logs:** https://dashboard.stripe.com/webhooks
- **Patreon API Docs:** https://docs.patreon.com/
- **PostgreSQL Performance:** https://wiki.postgresql.org/wiki/Performance_Optimization
- **PM2 Documentation:** https://pm2.keymetrics.io/docs/usage/quick-start/
- **Docker Best Practices:** https://docs.docker.com/develop/dev-best-practices/

---

**Emergency Runbook:** See `RUNBOOK.md` for step-by-step incident response procedures
