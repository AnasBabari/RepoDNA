from fastapi import APIRouter, Depends
from pydantic import BaseModel

router = APIRouter(prefix="/api/v1/items")


class ItemResponse(BaseModel):
    id: int
    name: str


@router.get(
    "/items/{item_id}",
    response_model=ItemResponse,
    dependencies=[Depends(verify_api_key)],
)
async def get_item(item_id: int) -> ItemResponse:
    return ItemResponse(id=item_id, name="widget")


def verify_api_key() -> None:
    pass


@app.post("/items")
def bare_app_decorator():
    return {}
