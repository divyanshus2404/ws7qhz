# Single image: build the React UI, then serve it and the API from one FastAPI process.

FROM node:20-alpine AS web
WORKDIR /web
COPY frontend/package.json frontend/package-lock.json ./
RUN npm ci
COPY frontend/ ./
RUN npm run build

FROM python:3.12-slim AS app
ENV PYTHONDONTWRITEBYTECODE=1 PYTHONUNBUFFERED=1
WORKDIR /app
COPY backend/requirements.txt ./
RUN pip install --no-cache-dir -r requirements.txt
COPY backend/app ./app
COPY backend/data ./data
COPY --from=web /web/dist ./static
RUN useradd --create-home appuser
USER appuser
EXPOSE 8000
# PORT is honoured so the same image runs on Heroku / Render / Cloud Run.
CMD ["sh", "-c", "uvicorn app.main:app --host 0.0.0.0 --port ${PORT:-8000}"]
