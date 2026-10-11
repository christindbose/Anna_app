#!/usr/bin/env bash
pkill -f "[m]odel_server.py" || true
pkill -f "[t]ts_server.py" || true
pkill -f "[u]vicorn app.main:app" || true
pkill -f "[n]ext start" || true
echo stopped
