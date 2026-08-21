from pathlib import Path
import json

import pandas as pd
from datasets import Dataset
from sklearn.metrics import accuracy_score, classification_report, f1_score
from sklearn.model_selection import train_test_split
from transformers import (
    AutoModelForSequenceClassification,
    AutoTokenizer,
    DataCollatorWithPadding,
    Trainer,
    TrainingArguments,
)

ROOT = Path(__file__).resolve().parent
DATA_PATH = ROOT / "data" / "event_issues.csv"
LABELS_PATH = ROOT / "labels.json"
MODEL_DIR = ROOT / "models" / "event-issue"
BASE_MODEL = "distilbert-base-uncased"


def main():
    labels = json.loads(LABELS_PATH.read_text(encoding="utf-8"))
    label2id = {label: i for i, label in enumerate(labels)}
    id2label = {i: label for label, i in label2id.items()}

    # label2id = {
    # "all_clear": 0,
    # "clothing": 1,
    # ...
    # }

    # id2label = {
    # 0: "all_clear",
    # 1: "clothing",
    # ...
    # }

    df = pd.read_csv(DATA_PATH)
    df["text"] = df["text"].astype(str).str.strip()
    df["label"] = df["label"].astype(str).str.strip()
    missing = sorted(set(df["label"]) - set(label2id))
    if missing:
        raise ValueError(f"Unknown labels in CSV: {missing}")

    df["label_id"] = df["label"].map(label2id)
    train_df, eval_df = train_test_split(
        df,
        test_size=0.2,
        random_state=42,
        stratify=df["label_id"],
    )

    tokenizer = AutoTokenizer.from_pretrained(BASE_MODEL)

    def tokenize(batch):
        # tokenizer turns text into tokens the model can read
        return tokenizer(batch["text"], truncation=True, max_length=128)

    train_ds = Dataset.from_pandas(
        train_df[["text", "label_id"]].rename(columns={"label_id": "labels"}),
        preserve_index=False,
    ).map(tokenize, batched=True)
    eval_ds = Dataset.from_pandas(
        eval_df[["text", "label_id"]].rename(columns={"label_id": "labels"}),
        preserve_index=False,
    ).map(tokenize, batched=True)

    # loads pre-trained model
    model = AutoModelForSequenceClassification.from_pretrained(
        BASE_MODEL,
        num_labels=len(labels),
        id2label=id2label,
        label2id=label2id,
    )

    def compute_metrics(eval_pred):
        logits, y_true = eval_pred
        y_pred = logits.argmax(axis=1)
        return {
            "accuracy": accuracy_score(y_true, y_pred),
            "f1": f1_score(y_true, y_pred, average="macro"),
        }

    args = TrainingArguments(
        output_dir=str(ROOT / "models" / "checkpoints"),
        num_train_epochs=4,
        per_device_train_batch_size=8,
        per_device_eval_batch_size=8,
        learning_rate=2e-5,
        weight_decay=0.01,
        eval_strategy="epoch",
        save_strategy="epoch",
        load_best_model_at_end=True,
        metric_for_best_model="f1",
        logging_steps=5,
        report_to="none",
        fp16=False,
        dataloader_pin_memory=False,
    )

    trainer = Trainer(
        model=model,
        args=args,
        train_dataset=train_ds,
        eval_dataset=eval_ds,
        processing_class=tokenizer,
        data_collator=DataCollatorWithPadding(tokenizer),
        compute_metrics=compute_metrics,
    )
    trainer.train()

    predictions = trainer.predict(eval_ds)
    y_pred = predictions.predictions.argmax(axis=1)
    y_true = predictions.label_ids
    print("\nClassification report:")
    print(classification_report(y_true, y_pred, target_names=labels, digits=3))

    MODEL_DIR.mkdir(parents=True, exist_ok=True)
    trainer.save_model(str(MODEL_DIR))
    tokenizer.save_pretrained(str(MODEL_DIR))
    print(f"Saved model to {MODEL_DIR}")


if __name__ == "__main__":
    main()
