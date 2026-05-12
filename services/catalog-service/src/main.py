import asyncio
import json
import logging
import os
import sys
import time

import asyncpg
import redis.asyncio as redis
import structlog
from fastapi import FastAPI, HTTPException, Response
from prometheus_client import CONTENT_TYPE_LATEST, Counter, Histogram, generate_latest

SERVICE = os.environ.get("SERVICE_NAME", "catalog-service")
PORT = int(os.environ.get("PORT", "3002"))
DATABASE_URL = os.environ["DATABASE_URL"]
REDIS_URL = os.environ.get("REDIS_URL", "redis://redis:6379")
CACHE_TTL = int(os.environ.get("CACHE_TTL_SECONDS", "60"))

logging.basicConfig(level=logging.INFO, format="%(message)s", stream=sys.stdout)
structlog.configure(processors=[structlog.processors.JSONRenderer()])
log = structlog.get_logger(service=SERVICE)

app = FastAPI(title="NimbusRetail Catalog Service", version="1.0.0")

http_requests = Counter("catalog_http_requests_total", "Total HTTP requests",
                        ["method", "route", "status"])
http_duration = Histogram("catalog_http_request_duration_seconds", "HTTP request duration",
                          ["method", "route", "status"])
cache_hits = Counter("catalog_cache_hits_total", "Cache hits")
cache_misses = Counter("catalog_cache_misses_total", "Cache misses")

state = {"db": None, "redis": None}


@app.on_event("startup")
async def startup():
    state["db"] = await asyncpg.create_pool(DATABASE_URL, min_size=2, max_size=10)
    state["redis"] = redis.from_url(REDIS_URL, decode_responses=True)
    log.info("startup complete", port=PORT)


@app.on_event("shutdown")
async def shutdown():
    if state["db"]:
        await state["db"].close()
    if state["redis"]:
        await state["redis"].aclose()
    log.info("shutdown complete")


@app.middleware("http")
async def metrics_middleware(request, call_next):
    start = time.perf_counter()
    response = await call_next(request)
    elapsed = time.perf_counter() - start
    route = request.url.path
    labels = dict(method=request.method, route=route, status=str(response.status_code))
    http_requests.labels(**labels).inc()
    http_duration.labels(**labels).observe(elapsed)
    return response


@app.get("/healthz")
async def healthz():
    return {"status": "ok"}


@app.get("/readyz")
async def readyz():
    try:
        async with state["db"].acquire() as conn:
            await conn.fetchval("SELECT 1")
        await state["redis"].ping()
        return {"status": "ready"}
    except Exception as e:
        raise HTTPException(status_code=503, detail=f"not ready: {e}")


@app.get("/metrics")
async def metrics():
    return Response(content=generate_latest(), media_type=CONTENT_TYPE_LATEST)


@app.get("/products")
async def list_products():
    cached = await state["redis"].get("products:all")
    if cached:
        cache_hits.inc()
        return json.loads(cached)
    cache_misses.inc()
    async with state["db"].acquire() as conn:
        rows = await conn.fetch(
            "SELECT id, name, description, price_cents, stock FROM catalog.products ORDER BY id"
        )
    products = [dict(r) for r in rows]
    await state["redis"].set("products:all", json.dumps(products), ex=CACHE_TTL)
    return products


@app.get("/products/{product_id}")
async def get_product(product_id: str):
    cache_key = f"product:{product_id}"
    cached = await state["redis"].get(cache_key)
    if cached:
        cache_hits.inc()
        return json.loads(cached)
    cache_misses.inc()
    async with state["db"].acquire() as conn:
        row = await conn.fetchrow(
            "SELECT id, name, description, price_cents, stock FROM catalog.products WHERE id = $1",
            product_id,
        )
    if not row:
        raise HTTPException(status_code=404, detail="product not found")
    product = dict(row)
    await state["redis"].set(cache_key, json.dumps(product), ex=CACHE_TTL)
    return product


if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=PORT, log_config=None)
