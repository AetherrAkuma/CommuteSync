# CommuteSync API Documentation

## Overview

CommuteSync is a commute tracking and prediction app. It supports multiple users via a simple `user_id` parameter in API calls.

## Base URL

```
http://localhost:3000/api
```

For deployed version, replace with your actual URL.

---

## Authentication

All endpoints support two methods to identify users:

### Method 1: Query Parameter
```
GET /api/routes?user_id=john_doe
```

### Method 2: HTTP Header
```
Header: x-user-id: john_doe
```

**Note:** If no user_id is provided, the API works in single-user mode (returns all data).

---

## Endpoints

### 1. Get All Routes
```http
GET /api/routes?user_id=YOUR_USER_ID
```

### 2. Get Trip History
```http
GET /api/logs?user_id=YOUR_USER_ID
```

### 3. Save New Trip Log

**Request:**
```http
POST /api/log?user_id=YOUR_USER_ID
Content-Type: application/json

{
  "route_id": "ROUTE_UUID",
  "date": "2026-02-17",
  "timestamps": {
    "arrived": "07:30:00",
    "boarded": "07:35:00", 
    "departed": "07:40:00",
    "dropped": "08:00:00"
  },
  "missed_cycles": 0
}
```

**Times are in 24-hour format (HH:MM:SS)**

### 4. Create New Route

```http
POST /api/routes?user_id=YOUR_USER_ID
Content-Type: application/json

{
  "name": "Work - Bus",
  "origin": "Home",
  "destination": "Office",
  "mode": "QCBus"
}
```

### 5. Save Schedule Rule

```http
POST /api/schedule?user_id=YOUR_USER_ID
Content-Type: application/json

{
  "route_id": "ROUTE_UUID",
  "day_type": "Weekday",
  "interval_minutes": 15,
  "start_time": "06:00",
  "end_time": "09:00"
}
```

**day_type values:** `Weekday`, `Saturday`, `Sunday/Holiday`

### 6. Get Presets

```http
GET /api/presets?user_id=YOUR_USER_ID
```

### 7. Save Preset

```http
POST /api/presets?user_id=YOUR_USER_ID
Content-Type: application/json

{
  "name": "Morning Commute",
  "route_ids": ["UUID1", "UUID2", "UUID3"]
}
```

### 8. Get Predictions

```http
POST /api/predict?user_id=YOUR_USER_ID
Content-Type: application/json

{
  "route_ids": ["UUID1", "UUID2"],
  "start_time": "07:30",
  "date": "2026-02-17"
}
```

**Response:**
```json
{
  "arrivals": {
    "best": "08:15",
    "safe": "08:25", 
    "worst": "08:45"
  },
  "breakdown": [...]
}
```

### 9. Get Analytics

```http
GET /api/analytics?user_id=YOUR_USER_ID
```

### 10. Get System Health (Benchmark)

```http
GET /api/benchmark?user_id=YOUR_USER_ID
```

### 11. Get Day-of-Week Stats

```http
GET /api/day-stats?user_id=YOUR_USER_ID
```

---

## MacroDroid / iOS Shortcuts Integration

### Saving a Trip Log

**URL:**
```
https://YOUR_DOMAIN/api/log?user_id=YOUR_USER_ID
```

**Method:** `POST`

**Headers:**
```
Content-Type: application/json
```

**Body (JSON):**
```json
{
  "route_id": "YOUR_ROUTE_UUID",
  "date": "{{date}}",
  "timestamps": {
    "arrived": "{{arrived_time}}",
    "boarded": "{{boarded_time}}",
    "departed": "{{departed_time}}",
    "dropped": "{{dropped_time}}"
  },
  "missed_cycles": 0
}
```

### Getting Routes

**URL:**
```
https://YOUR_DOMAIN/api/routes?user_id=YOUR_USER_ID
```

**Method:** `GET`

### Getting Predictions

**URL:**
```
https://YOUR_DOMAIN/api/predict?user_id=YOUR_USER_ID
```

**Method:** `POST`

**Body (JSON):**
```json
{
  "route_ids": ["UUID1", "UUID2"],
  "start_time": "{{start_time}}",
  "date": "{{date}}"
}
```

---

## Supabase Setup

Add `user_id` column to your tables:

```sql
-- Run these in Supabase SQL Editor
ALTER TABLE routes ADD COLUMN user_id TEXT;
ALTER TABLE trip_logs ADD COLUMN user_id TEXT;
ALTER TABLE route_schedules ADD COLUMN user_id TEXT;
ALTER TABLE presets ADD COLUMN user_id TEXT;
```

---

## Transport Modes

Valid values for `mode` field:
- `QCBus` - QC Bus
- `Jeep` - Jeepney
- `Tricycle` - Tricycle
- `Walking` - Walking
- `Bicycle` - Bicycle
- `Train` - Train
- Any custom name

---

## Response Times

**Best** - Lucky case (0 wait + fastest travel)
**Safe** - Most realistic (average wait + travel)  
**Worst** - Unlucky case (max wait + schedule interval + slowest travel)
