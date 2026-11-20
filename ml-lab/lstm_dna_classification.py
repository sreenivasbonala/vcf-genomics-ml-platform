"""
LSTM with 3D Input Tensors: Synthetic DNA Sequence Classification
Terminal-ready script matching Professor's Colab Notebook (Cells 1-9).
Runs in Conda `tensorflow_env` (TensorFlow 2.x) and saves both charts as PNGs.
"""

import os
import warnings
os.environ["TF_CPP_MIN_LOG_LEVEL"] = "2"
warnings.filterwarnings("ignore")

import numpy as np
import tensorflow as tf
import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt

from sklearn.model_selection import train_test_split
from sklearn.metrics import classification_report, confusion_matrix
from tensorflow.keras.models import Sequential
from tensorflow.keras.layers import Input, LSTM, Dense, Dropout

OUT_DIR = os.path.dirname(os.path.abspath(__file__))

# Set random seeds for reproducibility
np.random.seed(42)
tf.random.set_seed(42)

print("=" * 65)
print("CELL 1: IMPORTS")
print("=" * 65)
print("TensorFlow version:", tf.__version__)

print("\n" + "=" * 65)
print("CELL 2: GENERATE SYNTHETIC DNA SEQUENCES")
print("=" * 65)
DNA_BASES = ["A", "T", "G", "C"]
SEQUENCE_LENGTH = 30
NUMBER_OF_SAMPLES = 2000
MOTIF = "ATGCGT"


def generate_random_sequence(length):
    return "".join(np.random.choice(DNA_BASES, size=length))


sequences = []
labels = []

for i in range(NUMBER_OF_SAMPLES):
    sequence = generate_random_sequence(SEQUENCE_LENGTH)
    if i % 2 == 0:
        position = np.random.randint(0, SEQUENCE_LENGTH - len(MOTIF) + 1)
        sequence = sequence[:position] + MOTIF + sequence[position + len(MOTIF):]
        label = 1
    else:
        while MOTIF in sequence:
            sequence = generate_random_sequence(SEQUENCE_LENGTH)
        label = 0
    sequences.append(sequence)
    labels.append(label)

print("Example positive sequence:", sequences[0])
print("Corresponding label:      ", labels[0])
print("Example negative sequence:", sequences[1])
print("Corresponding label:      ", labels[1])

print("\n" + "=" * 65)
print("CELL 3: ONE-HOT ENCODING -> 3D INPUT TENSOR")
print("=" * 65)
base_to_index = {"A": 0, "T": 1, "G": 2, "C": 3}


def encode_sequence(sequence):
    encoded = np.zeros((SEQUENCE_LENGTH, 4), dtype=np.float32)
    for position, base in enumerate(sequence):
        encoded[position, base_to_index[base]] = 1.0
    return encoded


X = np.array([encode_sequence(seq) for seq in sequences])
y = np.array(labels)

print("Input tensor shape:", X.shape)
print("Target shape:      ", y.shape)
print("Sample 0 (first 5 positions):\n", X[0][:5])

print("\n" + "=" * 65)
print("CELL 4: STRATIFIED TRAIN / TEST SPLIT (80/20)")
print("=" * 65)
X_train, X_test, y_train, y_test = train_test_split(
    X, y, test_size=0.2, random_state=42, stratify=y
)
print("Training input shape:", X_train.shape)
print("Testing input shape: ", X_test.shape)

print("\n" + "=" * 65)
print("CELL 5: BUILD LSTM MODEL ARCHITECTURE")
print("=" * 65)
model = Sequential([
    Input(shape=(30, 4)),
    LSTM(units=32, return_sequences=False),
    Dropout(0.2),
    Dense(units=16, activation="relu"),
    Dense(units=1, activation="sigmoid"),
])

model.compile(
    optimizer="adam",
    loss="binary_crossentropy",
    metrics=["accuracy"],
)
model.summary()

# return_sequences demo
sample_input = tf.random.normal((1, 30, 4))
print("With return_sequences=True: ", LSTM(units=32, return_sequences=True)(sample_input).shape)
print("With return_sequences=False:", LSTM(units=32, return_sequences=False)(sample_input).shape)

print("\n" + "=" * 65)
print("CELL 6: TRAIN LSTM MODEL (15 EPOCHS, BATCH_SIZE=32)")
print("=" * 65)
history = model.fit(
    X_train,
    y_train,
    epochs=15,
    batch_size=32,
    validation_split=0.2,
    verbose=1,
)

print("\n" + "=" * 65)
print("CELL 7: SAVE TRAINING & VALIDATION CURVES")
print("=" * 65)
fig1 = plt.figure(figsize=(12, 4))
plt.subplot(1, 2, 1)
plt.plot(history.history["accuracy"], label="Training Accuracy", marker="o")
plt.plot(history.history["val_accuracy"], label="Validation Accuracy", marker="s")
plt.title("Model Accuracy")
plt.xlabel("Epoch")
plt.ylabel("Accuracy")
plt.legend()
plt.grid(True, alpha=0.3)

plt.subplot(1, 2, 2)
plt.plot(history.history["loss"], label="Training Loss", marker="o")
plt.plot(history.history["val_loss"], label="Validation Loss", marker="s")
plt.title("Model Loss")
plt.xlabel("Epoch")
plt.ylabel("Loss")
plt.legend()
plt.grid(True, alpha=0.3)

plt.tight_layout()
curves_path = os.path.join(OUT_DIR, "lstm_training_curves.png")
plt.savefig(curves_path, dpi=150)
plt.close(fig1)
print("Saved training curves to:", curves_path)

print("\n" + "=" * 65)
print("CELL 8: EVALUATE ON UNSEEN TEST DATA (400 SEQUENCES)")
print("=" * 65)
test_loss, test_accuracy = model.evaluate(X_test, y_test, verbose=0)
print(f"Test Loss:     {test_loss:.4f}")
print(f"Test Accuracy: {test_accuracy:.4f}\n")

predictions = model.predict(X_test, verbose=0)
predicted_classes = (predictions >= 0.5).astype(int).flatten()

print("Classification Report:")
print(classification_report(
    y_test,
    predicted_classes,
    target_names=["Motif Absent (0)", "Motif Present (1)"],
))

cm = confusion_matrix(y_test, predicted_classes)
fig2, ax = plt.subplots(figsize=(5, 4))
im = ax.imshow(cm, cmap="Blues")
plt.colorbar(im, ax=ax)
tick_labels = ["Absent", "Present"]
ax.set_xticks([0, 1])
ax.set_yticks([0, 1])
ax.set_xticklabels(tick_labels)
ax.set_yticklabels(tick_labels)
thresh = cm.max() / 2.0
for i in range(2):
    for j in range(2):
        ax.text(j, i, str(cm[i, j]), ha="center", va="center",
                color="white" if cm[i, j] > thresh else "black", fontsize=14, fontweight="bold")
ax.set_xlabel("Predicted")
ax.set_ylabel("Actual")
ax.set_title("LSTM Confusion Matrix")
plt.tight_layout()
cm_path = os.path.join(OUT_DIR, "lstm_confusion_matrix.png")
plt.savefig(cm_path, dpi=150)
plt.close(fig2)
print("Saved confusion matrix to:", cm_path)

print("\n" + "=" * 65)
print("CELL 9: TEST CUSTOM DNA SEQUENCES (predict_motif)")
print("=" * 65)


def predict_motif(sequence):
    sequence = sequence.upper().strip()
    if len(sequence) != SEQUENCE_LENGTH:
        raise ValueError(f"Sequence must be exactly {SEQUENCE_LENGTH} bases long (got {len(sequence)}).")
    encoded = np.expand_dims(encode_sequence(sequence), axis=0)
    probability = float(model.predict(encoded, verbose=0)[0][0])
    prediction = "Motif Present" if probability >= 0.5 else "Motif Absent"
    print(f"Sequence:    {sequence}")
    print(f"Probability: {probability:.4f}")
    print(f"Prediction:  {prediction}\n")


predict_motif("ATGCGTACGTACGTACGTACGTACGTACGT")  # 1. Motif at start
predict_motif("AAAAAAAAAATTTTTTTTTTATGCGTCCCC")  # 2. Motif near end
predict_motif("AAAAAAAAAATTTTTTTTTTCCCCCCCCCC")  # 3. Motif absent
