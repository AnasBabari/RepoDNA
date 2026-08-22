from pydantic import BaseModel

class User(BaseModel):
    id: int | None = None
    email: str
    is_active: bool = True
