from fastapi import APIRouter
from app.models.user import User
from app.services.user_service import UserService

router = APIRouter()

@router.get("/")
def get_users() -> list[User]:
    service = UserService()
    return service.list_users()

@router.post("/", status_code=201)
def create_user(user: User) -> User:
    service = UserService()
    return service.create_user(user)
