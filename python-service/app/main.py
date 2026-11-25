import logging

from fastapi import FastAPI, Request
from fastapi.responses import JSONResponse

from app.api.health import router as health_router

logger = logging.getLogger(__name__)

app = FastAPI(title="Tula Carbon Python Service")
app.include_router(health_router)


@app.exception_handler(Exception)
async def unhandled_error(_request: Request, exc: Exception) -> JSONResponse:
    logger.exception("Unhandled error", exc_info=exc)
    return JSONResponse(status_code=500, content={"error": "Internal server error"})
