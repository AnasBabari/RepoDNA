from fastapi import APIRouter
from ..services.users import UserService

router = APIRouter()

@router.post("/users")
def create_user():
    return UserService.create()

@router.get("/users/{user_id}")
def get_user(user_id: int):
    return UserService.get(user_id)
