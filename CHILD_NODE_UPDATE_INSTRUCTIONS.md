# Child Node Update Instructions

The child node at **192.168.1.170** needs to be updated with the latest code.

## Quick Fix (Run on the child node):

```bash
# SSH to the child node
ssh root@192.168.1.170

# Restart the BitBonsai containers
docker restart bitbonsai-backend bitbonsai-frontend

# Wait 15 seconds for services to start
sleep 15

# Verify the fix
curl http://localhost:3100/api/v1/nodes/current | grep mainNodeUrl

# You should see: "mainNodeUrl": "http://192.168.1.100:3100"
```

## What This Fixes:

- The child node's frontend will now automatically proxy queue requests to the main node
- You'll be able to see delegated jobs on the child node's UI at http://192.168.1.170:3000/

## Alternative: Full Redeploy

If the above doesn't work, you may need to redeploy the child node completely with the latest code from the repository.

