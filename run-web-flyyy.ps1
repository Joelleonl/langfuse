# Runs Langfuse web from source on the host, reusing the docker container's env
# (same SALT / ENCRYPTION_KEY / NEXTAUTH_SECRET) with hostnames mapped to localhost ports.
$ErrorActionPreference = "Stop"
# Prefer the (stopped) web container; fall back to the worker, which shares the same
# base env (docker-compose `langfuse-worker-env` anchor).
$source = "langfuse-langfuse-web-1"
$webExists = docker ps -a --filter "name=^langfuse-langfuse-web-1$" --format "{{.Names}}"
if (-not $webExists) { $source = "langfuse-langfuse-worker-1" }
$envList = docker inspect $source --format '{{json .Config.Env}}' | ConvertFrom-Json
if (-not $envList) { throw "Start the Langfuse containers first: docker compose up -d postgres clickhouse redis minio langfuse-worker" }
# Web-only vars from docker-compose.yml (defaults, unless set in .env).
$env:NEXTAUTH_SECRET = "mysecret"
$env:LANGFUSE_S3_MEDIA_UPLOAD_ENDPOINT = "http://localhost:9090"
$env:LANGFUSE_S3_MEDIA_UPLOAD_INTERNAL_ENDPOINT = "http://localhost:9090"
$map = @{
  "@postgres:5432" = "@localhost:5433"
  "//clickhouse:8123" = "//localhost:8123"
  "//clickhouse:9000" = "//localhost:9000"
  "//minio:9000" = "//localhost:9090"
}
$skip = @("PATH", "HOSTNAME", "NODE_VERSION", "YARN_VERSION", "HOME", "NODE_ENV", "PORT")
foreach ($e in $envList) {
  $k, $v = $e -split "=", 2
  if ($skip -contains $k -or $k -like "NEXT_*" -and $k -ne "NEXTAUTH_URL") { continue }
  foreach ($from in $map.Keys) { $v = $v.Replace($from, $map[$from]) }
  if ($k -eq "REDIS_HOST") { $v = "localhost" }
  Set-Item -Path "Env:$k" -Value $v
}
$secretLine = Get-Content D:\Documents3\Internship_flyyy.ai\langfuse\langfuse\.env | Where-Object { $_ -like "FLYYY_PROVISIONING_SECRET=*" }
$env:FLYYY_PROVISIONING_SECRET = ($secretLine -split "=", 2)[1].Trim()
Set-Location D:\Documents3\Internship_flyyy.ai\langfuse\langfuse\web
npx --no-install next dev -p 3000
