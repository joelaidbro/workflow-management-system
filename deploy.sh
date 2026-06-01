#!/bin/bash
set -e

PROJECT_DIR="/home/teams.aidbro.com/workflow"

echo "=== Deploying WorkFlow App ==="

echo "--- Updating backend ---"
cd $PROJECT_DIR/backend
source .venv/bin/activate
pip install -r requirements.txt --quiet
alembic upgrade head
sudo systemctl restart workflowapp
echo "Backend updated and restarted"

echo "--- Building frontend ---"
cd $PROJECT_DIR/frontend
npm install --silent
npm run build
# Copy build output to CyberPanel public_html
cp -r dist/* /home/teams.aidbro.com/public_html/
echo "Frontend deployed to public_html"

echo "=== Deployment complete ==="
