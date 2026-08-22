# FastAPI Basic Fixture
from fastapi import FastAPI
from app.routes.users import router as users_router

app = FastAPI(title="FastAPI Fixture")
app.include_router(users_router, prefix="/api/v1/users")
