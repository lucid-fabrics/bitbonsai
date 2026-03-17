-- Fix for child nodes missing mainNodeUrl
-- Run this on the child node's database

UPDATE Node
SET mainNodeUrl = 'http://192.168.1.100:3100/api/v1'
WHERE role = 'LINKED'
  AND (mainNodeUrl IS NULL OR mainNodeUrl = '');

SELECT id, name, role, mainNodeUrl FROM Node;
