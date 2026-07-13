#!/bin/bash
# Certbot post-renewal hook for WorkFlow backend.
#
# Certbot runs this script automatically after every successful cert renewal.
# Gunicorn loads the TLS cert at startup and holds it in memory — without this
# hook it would keep serving the old (now expired) cert until next restart.
#
# Install on the server (one-time):
#   cp /home/teams.aidbro.com/workflow/server-config/certbot-renewal-hook.sh \
#      /etc/letsencrypt/renewal-hooks/deploy/restart-workflowapp.sh
#   chmod +x /etc/letsencrypt/renewal-hooks/deploy/restart-workflowapp.sh
#
# Verify it works:
#   certbot renew --dry-run

set -e

# Re-apply ACLs so workflowapp can read the newly issued cert files.
# (privkey.pem in /etc/letsencrypt/archive/ is created 600/root on every renewal)
setfacl -R -m u:workflowapp:rX /etc/letsencrypt/live/
setfacl -R -m u:workflowapp:rX /etc/letsencrypt/archive/

systemctl restart workflowapp
