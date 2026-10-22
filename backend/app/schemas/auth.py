"""Auth API schemas (Pydantic).

These models define what the frontend is allowed to send/receive for auth endpoints.
"""

from pydantic import BaseModel, ConfigDict, Field, field_validator

from app.schemas.common import UTCDateTime


class RegisterRequest(BaseModel):
    """Request body for POST /register."""
    username: str = Field(min_length=3, max_length=50)
    password: str = Field(min_length=8, max_length=128)

    @field_validator("username")
    @classmethod
    def normalize_username(cls, value: str) -> str:
        normalized = value.strip()
        if not normalized:
            raise ValueError("Username cannot be empty.")
        return normalized


class LoginRequest(BaseModel):
    """Request body for POST /login."""
    username: str = Field(min_length=3, max_length=50)
    password: str = Field(min_length=8, max_length=128)

    @field_validator("username")
    @classmethod
    def normalize_username(cls, value: str) -> str:
        normalized = value.strip()
        if not normalized:
            raise ValueError("Username cannot be empty.")
        return normalized


class UserRead(BaseModel):
    """Public user fields returned to the client."""
    model_config = ConfigDict(from_attributes=True)

    id: int
    username: str
    created_at: UTCDateTime
    avatar: str | None = None


class AuthResponse(BaseModel):
    """Response body for successful auth (includes session token)."""
    message: str
    token: str
    user: UserRead


class UpdateUsernameRequest(BaseModel):
    new_username: str = Field(min_length=3, max_length=50)
    password: str = Field(min_length=1)


class UpdatePasswordRequest(BaseModel):
    current_password: str = Field(min_length=1)
    new_password: str = Field(min_length=8, max_length=128)


class UpdateAvatarRequest(BaseModel):
    avatar: str | None = None


class DeleteAccountRequest(BaseModel):
    password: str = Field(min_length=1)
