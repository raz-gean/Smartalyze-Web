"""Small field types shared by several response schemas."""

from datetime import datetime, timezone
from typing import Annotated

from pydantic import AfterValidator


def _assume_utc(value: datetime) -> datetime:
    # Timestamps are stored as naive UTC (datetime.utcnow); mark them as UTC so the
    # JSON carries "Z" and browsers convert them to the viewer's local time.
    return value.replace(tzinfo=timezone.utc) if value.tzinfo is None else value


UTCDateTime = Annotated[datetime, AfterValidator(_assume_utc)]
