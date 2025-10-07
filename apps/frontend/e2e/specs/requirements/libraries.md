# Libraries Feature - Product Requirements Document

## Overview

The Libraries feature allows users to manage video libraries that are monitored for encoding. Each library represents a directory path on a compute node that contains video files to be processed according to encoding policies.

## User Personas

### Primary User: Media Server Administrator
- Manages large video collections across multiple storage locations
- Needs to apply encoding policies to different libraries
- Monitors encoding progress and library statistics
- Troubleshoots failed encoding jobs

## Core Features

### 1. Library List View

**Purpose:** Display all configured libraries with their current status and statistics.

**Requirements:**
- Display libraries in a data table/grid format
- Show the following columns for each library:
  - **Name** - User-friendly library name
  - **Path** - Full filesystem path being monitored
  - **Node** - Which compute node manages this library
  - **Policy** - Which encoding policy is applied
  - **Status** - Current state (Active, Paused, Scanning, Error)
  - **File Count** - Number of video files in the library
  - **Total Size** - Combined size of all videos
  - **Actions** - Edit, Delete, Scan Now buttons

**Visual Elements:**
- Search/filter box to find libraries by name or path
- Sort capability on all columns
- Status indicators with color coding (green=active, yellow=scanning, red=error)
- Refresh button to reload library data
- "Create New Library" button prominently displayed

**Empty State:**
- When no libraries exist, show helpful message: "No libraries configured. Create your first library to start encoding."
- Display "Create Library" call-to-action button

### 2. Create Library

**Purpose:** Add a new library to the system.

**Form Fields:**
- **Library Name** (required)
  - Text input, max 100 characters
  - Must be unique across all libraries
  - Example: "Movies - 4K Collection"

- **Path** (required)
  - Path selector/browser component
  - Must be an existing directory on the selected node
  - Shows validation error if path doesn't exist
  - Example: "/mnt/media/movies"

- **Node** (auto-assigned)
  - Automatically selects first available node
  - Dropdown to change if multiple nodes available
  - Shows node name and status

- **Policy** (required)
  - Dropdown of available encoding policies
  - Shows policy name and preset (e.g., "4K HEVC - BALANCED_HEVC")
  - Must select a policy before saving

**Validation:**
- Name cannot be empty
- Name must be unique
- Path must exist on selected node
- Path must be a directory (not a file)
- Policy must be selected
- Show inline validation errors as user types

**Behavior:**
- On success: Close dialog, show success toast, refresh library list
- On error: Show error message, keep dialog open for correction
- Cancel button discards changes and closes dialog

### 3. Edit Library

**Purpose:** Modify an existing library's configuration.

**Requirements:**
- Same form fields as Create Library
- Pre-populate with current library values
- Allow changing name, path, node, and policy
- **WARNING:** Changing path or policy affects all files in library
- Show confirmation dialog if policy is changed: "Changing the policy will re-process all videos in this library. Continue?"

**Validation:**
- Same rules as Create Library
- Name must be unique (excluding current library)

### 4. Delete Library

**Purpose:** Remove a library from monitoring.

**Requirements:**
- Show confirmation dialog before deletion
- Dialog shows:
  - Library name and path
  - Number of files that will stop being monitored
  - Warning: "This will not delete files, only stop monitoring this directory"
  - Checkbox: "Also cancel any pending encoding jobs for this library"

**Behavior:**
- On confirm: Delete library, show success toast, refresh list
- On cancel: Close dialog, no changes

### 5. Scan Library Now

**Purpose:** Trigger an immediate rescan of a library to detect new/changed files.

**Requirements:**
- Available as action button on each library row
- Shows loading indicator while scanning
- Updates file count and total size when complete
- Shows toast notification: "Scan complete. Found X new files."

**Error Handling:**
- If node is offline: Show error "Cannot scan - node [name] is offline"
- If path no longer exists: Show error "Path not found on node"

### 6. Library Statistics

**Purpose:** Display aggregate statistics across all libraries.

**Requirements:**
- Summary cards at top of page showing:
  - **Total Libraries** - Count of all libraries
  - **Total Files** - Sum of files across all libraries
  - **Total Size** - Sum of storage across all libraries
  - **Active Jobs** - Number of files currently encoding from all libraries

**Refresh:**
- Auto-refresh every 30 seconds when page is active
- Manual refresh button

### 7. Path Selection Component

**Purpose:** Allow users to browse and select filesystem paths on remote nodes.

**Requirements:**
- Modal dialog with directory tree browser
- Shows folder structure of selected node
- Navigate by clicking folders (expand/collapse)
- Breadcrumb navigation showing current path
- "Select" button to confirm path
- Shows loading state while fetching directory contents
- Shows error if node cannot be reached
- Must handle paths with special characters, spaces, unicode

**Accessibility:**
- Keyboard navigation (arrow keys, enter, escape)
- Screen reader support for folder tree
- Focus management in modal dialog

## API Endpoints Used

### GET /api/libraries
- Fetches all libraries
- Returns array of library objects with statistics

### POST /api/libraries
- Creates new library
- Body: `{ name, path, policyId }` (nodeId auto-assigned)
- Returns created library object

### PATCH /api/libraries/:id
- Updates existing library
- Body: `{ name?, path?, nodeId?, policyId? }`
- Returns updated library object

### DELETE /api/libraries/:id
- Deletes library
- Returns success/error status

### POST /api/libraries/:id/scan
- Triggers immediate library scan
- Returns scan results (new files found, updated counts)

### GET /api/nodes
- Fetches available nodes for selection
- Returns array of node objects

### GET /api/policies
- Fetches available encoding policies
- Returns array of policy objects

### GET /api/nodes/:id/browse
- Browse filesystem on specific node
- Query param: `path` (directory to list)
- Returns array of subdirectories

## User Workflows

### Workflow 1: Create First Library
1. User lands on empty libraries page
2. Clicks "Create Library" button
3. Enters library name: "TV Shows"
4. Clicks path selector
5. Browses to `/mnt/media/tv`
6. Selects path
7. Node auto-assigned to first available node
8. Selects policy from dropdown: "TV HEVC - BALANCED_HEVC"
9. Clicks "Save"
10. Library appears in list, scan begins automatically
11. Success toast shown: "Library created successfully"

### Workflow 2: Edit Library Policy
1. User finds library "Movies" in the list
2. Clicks "Edit" action button
3. Changes policy from "BALANCED_HEVC" to "QUALITY_HEVC"
4. Confirmation dialog appears: "Changing the policy will re-process all videos..."
5. User clicks "Continue"
6. Library updated, pending jobs created for re-encoding
7. Success toast shown: "Library updated. Re-encoding queued for 150 files."

### Workflow 3: Delete Library
1. User finds library "Old Archive" in the list
2. Clicks "Delete" action button
3. Confirmation dialog shows: "This library has 45 files. Delete?"
4. User checks "Also cancel pending jobs" checkbox
5. User clicks "Confirm Delete"
6. Library removed from list
7. Success toast shown: "Library deleted. 12 pending jobs cancelled."

### Workflow 4: Manual Scan
1. User notices new files added to library directory
2. Clicks "Scan Now" button on library row
3. Loading indicator appears on that row
4. Scan completes after 3 seconds
5. File count updates from 100 to 105
6. Toast shown: "Scan complete. Found 5 new files."

## Error Scenarios

### Network Error
- **Trigger:** API request fails due to network/server error
- **Response:** Show error toast: "Failed to load libraries. Please try again."
- **Retry:** Show "Retry" button in empty state

### Validation Error
- **Trigger:** User submits form with invalid data
- **Response:** Show inline error messages on form fields
- **Example:** "Path does not exist on node 'pve-ai'"

### Permission Error
- **Trigger:** User lacks permission to access node path
- **Response:** Show error: "Permission denied. Cannot access path on node."

### Node Offline
- **Trigger:** Selected node is not reachable
- **Response:** Show warning icon on library row, disable "Scan Now" button
- **Tooltip:** "Node offline - library cannot be scanned"

### Duplicate Name
- **Trigger:** User tries to create library with existing name
- **Response:** Show error on name field: "A library with this name already exists"

## Accessibility Requirements

- All interactive elements keyboard accessible (Tab, Enter, Escape)
- Form fields have proper labels and ARIA attributes
- Error messages announced to screen readers
- Loading states have ARIA live regions
- Tables have proper headers and row/column associations
- Modals trap focus and return focus on close
- Color is not the only indicator of status (use icons + text)

## Performance Requirements

- Library list must load within 2 seconds
- Path browser must show directories within 1 second
- Form submission feedback within 500ms (optimistic UI)
- Table supports pagination/virtual scrolling for 1000+ libraries
- Auto-refresh does not disrupt user interactions

## Future Enhancements (Out of Scope for Initial Implementation)

- Bulk operations (delete multiple libraries)
- Library groups/tags for organization
- Custom file filters (only encode files matching pattern)
- Scheduled scans (daily at 2am)
- Library health indicators (missing files, failed jobs)
- Export/import library configurations

## Success Criteria

- User can create, read, update, and delete libraries
- Path selector works reliably across different node configurations
- Form validation prevents invalid library configurations
- Statistics update in real-time as encoding progresses
- Error states provide clear guidance for resolution
- Interface is accessible to keyboard-only users
- No data loss during library operations
