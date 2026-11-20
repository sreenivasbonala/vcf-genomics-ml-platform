from pathlib import Path
from typing import List
import joblib
import pandas as pd
from fastapi import FastAPI, HTTPException
from pydantic import BaseModel, Field

MODEL_PATH = Path(__file__).resolve().parent / "iris_demo_pipeline.joblib"
model = joblib.load(MODEL_PATH)  # load once at startup

FEATURE_NAMES = [
    "sepal length (cm)",
    "sepal width (cm)",
    "petal length (cm)",
    "petal width (cm)",
]
CLASS_NAMES = ["setosa", "versicolor", "virginica"]

app = FastAPI(title="Iris Species Prediction API", version="1.0.0")


class PredictionRequest(BaseModel):
    features: List[float] = Field(
        ...,
        description="Four measurements in cm, in the documented order: sepal length, sepal width, petal length, petal width",
        examples=[[5.1, 3.5, 1.4, 0.2]],
    )


@app.get("/")
def health():
    return {"status": "ok", "model_version": "iris-demo-1.0"}


@app.post("/predict")
def predict(request: PredictionRequest):
    if len(request.features) != len(FEATURE_NAMES):
        raise HTTPException(
            status_code=422, detail=f"Expected {len(FEATURE_NAMES)} features"
        )
    row = pd.DataFrame([request.features], columns=FEATURE_NAMES)
    label = int(model.predict(row)[0])
    probs = model.predict_proba(row)[0].tolist()
    return {
        "prediction": CLASS_NAMES[label],
        "class_code": label,
        "probabilities_in_class_order": dict(zip(CLASS_NAMES, probs)),
        "model_version": "iris-demo-1.0",
    }
