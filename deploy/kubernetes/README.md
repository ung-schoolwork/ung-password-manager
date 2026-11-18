# Kubernetes deployment

Production runs at <https://passwords.mediasave.llc> on a k3s cluster, in the
`ung-password-manager` namespace:

| File                    | What it creates                                                                                     |
| ----------------------- | --------------------------------------------------------------------------------------------------- |
| `namespace.yaml`        | The namespace.                                                                                      |
| `mongo.yaml`            | MongoDB 8 (StatefulSet, 10Gi `local-path` volume). Creates the app user on first start.             |
| `site.yaml`             | The Next.js site (Deployment and a ClusterIP Service on port 3000).                                 |
| `ingress.yaml`          | A `cloudflare-tunnel` Ingress. The controller adds the proxied DNS record; Cloudflare serves HTTPS. |
| `network-policies.yaml` | Denies inbound traffic except tunnel → site and site/backup → Mongo.                                |
| `backup.yaml`           | A daily `mongodump` CronJob (03:37 UTC) to a 5Gi volume, keeping the newest 14 archives.            |

Everything is pinned to the `threaderipper-server-nvme` worker, because
`local-path` volumes live on that node's disk.

Sign-in rate limits read the client IP from the header named by
`AUTH_TRUSTED_IP_HEADER` (`cf-connecting-ip` in `site.yaml`). If it is missing,
production refuses sign-in and registration.

The image `ghcr.io/ung-schoolwork/ung-password-manager` is built by
`.github/workflows/image.yml` on every push to `main` and tagged `latest` and
`sha-<short commit>`. The build bakes `APP_ORIGIN` into build-time output such
as the extension download.

## First deploy

```bash
kubectl apply -f deploy/kubernetes/namespace.yaml

# Secrets. Never commit or paste the real values.
ROOT_PW=$(openssl rand -hex 24)
APP_PW=$(openssl rand -hex 24)
kubectl -n ung-password-manager create secret generic ung-mongo-auth \
  --from-literal=rootUsername=root \
  --from-literal=rootPassword="$ROOT_PW" \
  --from-literal=appUsername=ung_app \
  --from-literal=appPassword="$APP_PW"
kubectl -n ung-password-manager create secret generic ung-site \
  --from-literal=MONGODB_URI="mongodb://ung_app:${APP_PW}@ung-mongo-0.ung-mongo.ung-password-manager.svc.cluster.local:27017/ung_password_manager?authSource=ung_password_manager" \
  --from-literal=SHARE_ENCRYPTION_KEY="$(openssl rand -base64 32)"
unset ROOT_PW APP_PW

kubectl apply -f deploy/kubernetes/network-policies.yaml -f deploy/kubernetes/mongo.yaml
kubectl -n ung-password-manager rollout status statefulset/ung-mongo
kubectl apply -f deploy/kubernetes/site.yaml -f deploy/kubernetes/ingress.yaml -f deploy/kubernetes/backup.yaml
kubectl -n ung-password-manager rollout status deployment/ung-site
curl -sI https://passwords.mediasave.llc/sign-in   # expect 200
```

The app user is created only when Mongo starts on an empty volume. Changing
`SHARE_ENCRYPTION_KEY` later makes existing shares unreadable.

## Redeploy and roll back

```bash
# After the Image workflow publishes a new latest:
kubectl -n ung-password-manager rollout restart deployment/ung-site

# Roll back to a specific build:
kubectl -n ung-password-manager set image deployment/ung-site \
  site=ghcr.io/ung-schoolwork/ung-password-manager:sha-<short>
```

## Backups

Archives are in the `ung-mongo-backups` volume. Run one now with:

```bash
kubectl -n ung-password-manager create job --from=cronjob/ung-mongo-backup backup-manual
```

Restore an archive with `mongorestore --uri "$MONGODB_URI" --archive=<file> --gzip --drop`
from a pod labelled `app: ung-backup` (only it and the site can reach Mongo).
The volume is on the same disk as the database, so copy archives off the node
for protection against losing that disk.
