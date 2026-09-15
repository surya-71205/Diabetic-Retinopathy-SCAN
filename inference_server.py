"""
MobileNetV3 Diabetic Retinopathy Inference Microservice
Loads: DR-MobileNetV3-main/DR-MobileNetV3-main/mobilenetv3_dr.pth
Architecture: MobileNetV3-Large with Linear(1280, 5) classification head
Grad-CAM: Final convolutional layer features[16]
"""

import os
import io
import time
import base64
import numpy as np
from PIL import Image

import torch
import torchvision.models as models
import torchvision.transforms as transforms
from flask import Flask, request, jsonify
from flask_cors import CORS

app = Flask(__name__)
CORS(app, resources={r"/api/*": {"origins": "*"}})

# Configuration
CHECKPOINT_PATH = os.path.join(
    os.path.dirname(os.path.abspath(__file__)),
    'DR-MobileNetV3-main',
    'DR-MobileNetV3-main',
    'mobilenetv3_dr.pth'
)

DEVICE = torch.device('cuda' if torch.cuda.is_available() else 'cpu')

# Clinical 5-Class Nomenclature (Option A)
CLASSES = [
    {
        "index": 0,
        "key": "No_DR",
        "label": "0 - No_DR",
        "short_label": "0 - No_DR",
        "dr_stage": "No DR",
        "clinical_name": "No Diabetic Retinopathy",
        "icdr_grade": "Grade 0",
        "severity_level": "None"
    },
    {
        "index": 1,
        "key": "Mild",
        "label": "1 - Mild (Mild NPDR)",
        "short_label": "1 - Mild",
        "dr_stage": "Mild NPDR",
        "clinical_name": "Mild Non-Proliferative Diabetic Retinopathy",
        "icdr_grade": "Grade 1",
        "severity_level": "Mild"
    },
    {
        "index": 2,
        "key": "Moderate",
        "label": "2 - Moderate (Moderate NPDR)",
        "short_label": "2 - Moderate",
        "dr_stage": "Moderate NPDR",
        "clinical_name": "Moderate Non-Proliferative Diabetic Retinopathy",
        "icdr_grade": "Grade 2",
        "severity_level": "Moderate"
    },
    {
        "index": 3,
        "key": "Severe",
        "label": "3 - Severe (Severe NPDR)",
        "short_label": "3 - Severe",
        "dr_stage": "Severe NPDR",
        "clinical_name": "Severe Non-Proliferative Diabetic Retinopathy",
        "icdr_grade": "Grade 3",
        "severity_level": "Severe"
    },
    {
        "index": 4,
        "key": "Proliferate_DR",
        "label": "4 - Proliferate_DR (PDR)",
        "short_label": "4 - Proliferate_DR",
        "dr_stage": "PDR",
        "clinical_name": "Proliferative Diabetic Retinopathy",
        "icdr_grade": "Grade 4",
        "severity_level": "Proliferative"
    }
]

# Benchmark image preprocessing
IMAGE_TRANSFORM = transforms.Compose([
    transforms.Resize((224, 224)),
    transforms.ToTensor(),
    transforms.Normalize(mean=[0.485, 0.456, 0.406], std=[0.229, 0.224, 0.225])
])

# Global model container
model = None

def load_mobilenet_model():
    global model
    print(f"[INIT] Loading MobileNetV3-Large checkpoint from: {CHECKPOINT_PATH}")
    if not os.path.exists(CHECKPOINT_PATH):
        raise FileNotFoundError(f"Checkpoint not found at: {CHECKPOINT_PATH}")

    net = models.mobilenet_v3_large(weights=None)
    in_features = net.classifier[3].in_features
    net.classifier[3] = torch.nn.Linear(in_features, 5)

    state_dict = torch.load(CHECKPOINT_PATH, map_location=DEVICE, weights_only=True)
    load_result = net.load_state_dict(state_dict)
    print(f"[INIT] Checkpoint loaded successfully: {load_result}")

    net.to(DEVICE)
    net.eval()
    model = net
    print(f"[INIT] MobileNetV3-Large ready on device: {DEVICE}")

try:
    load_mobilenet_model()
except Exception as err:
    print(f"[ERROR] Failed to load model on startup: {err}")


def compute_gradcam(model, input_tensor, target_class):
    """
    Computes genuine Grad-CAM activation heatmap from features[16]
    for the target class backward score.
    """
    features = []
    gradients = []

    def forward_hook(module, inp, outp):
        features.append(outp)

    def backward_hook(module, grad_in, grad_out):
        gradients.append(grad_out[0])

    target_layer = model.features[16]
    h_fwd = target_layer.register_forward_hook(forward_hook)
    h_bwd = target_layer.register_full_backward_hook(backward_hook)

    try:
        model.zero_grad()
        output = model(input_tensor)
        score = output[0, target_class]
        score.backward()

        feat = features[0].squeeze(0)      # [960, 7, 7]
        grad = gradients[0].squeeze(0)     # [960, 7, 7]

        # Global average pool gradients over spatial dimensions
        weights = grad.mean(dim=[1, 2], keepdim=True) # [960, 1, 1]
        cam = (weights * feat).sum(dim=0).clamp(min=0)  # [7, 7] ReLU

        cam_min = cam.min()
        cam_max = cam.max()
        if cam_max > cam_min:
            cam = (cam - cam_min) / (cam_max - cam_min)
        else:
            cam = torch.zeros_like(cam)

        cam_np = cam.detach().cpu().numpy()
        return cam_np
    finally:
        h_fwd.remove()
        h_bwd.remove()


def colormap_to_rgba(cam_np, target_size=(512, 512)):
    """
    Upsamples 7x7 Grad-CAM matrix to target_size and renders a transparent
    medical turbo/jet heatmap (RGBA).
    """
    cam_img = Image.fromarray((cam_np * 255).astype(np.uint8), mode='L')
    cam_resized = cam_img.resize(target_size, Image.Resampling.BICUBIC)
    arr = np.array(cam_resized).astype(np.float32) / 255.0

    # Custom medical jet/turbo colormap with smooth transitions
    r = np.clip(1.5 - np.abs(arr * 4.0 - 3.0), 0.0, 1.0)
    g = np.clip(1.5 - np.abs(arr * 4.0 - 2.0), 0.0, 1.0)
    b = np.clip(1.5 - np.abs(arr * 4.0 - 1.0), 0.0, 1.0)

    # Transparency: lower weights transparent, focal areas clearly visible
    alpha = np.clip(arr * 1.5, 0.0, 0.85)

    rgba = np.stack([
        (r * 255).astype(np.uint8),
        (g * 255).astype(np.uint8),
        (b * 255).astype(np.uint8),
        (alpha * 255).astype(np.uint8)
    ], axis=-1)

    return Image.fromarray(rgba, mode='RGBA')


def pil_to_base64_png(img):
    """Encodes a PIL image to a Base64 PNG data URL."""
    buffer = io.BytesIO()
    img.save(buffer, format="PNG")
    b64 = base64.b64encode(buffer.getvalue()).decode('utf-8')
    return f"data:image/png;base64,{b64}"


@app.route('/api/health', methods=['GET'])
def health_check():
    return jsonify({
        "status": "healthy",
        "model": "MobileNetV3-Large",
        "checkpoint": "mobilenetv3_dr.pth",
        "device": str(DEVICE),
        "classes_count": len(CLASSES),
        "is_model_loaded": model is not None
    })


@app.route('/api/predict', methods=['POST'])
def predict():
    start_time = time.time()
    if model is None:
        return jsonify({"error": "MobileNetV3 model not loaded"}), 500

    img = None
    # 1. Parse image from multipart file or JSON base64 data
    if 'file' in request.files:
        file = request.files['file']
        img = Image.open(file.stream).convert('RGB')
    elif request.is_json:
        data = request.get_json()
        data_url = data.get('image', '')
        if data_url.startswith('data:image'):
            header, encoded = data_url.split(',', 1)
            img_bytes = base64.b64decode(encoded)
            img = Image.open(io.BytesIO(img_bytes)).convert('RGB')
        elif os.path.exists(data_url):
            img = Image.open(data_url).convert('RGB')

    if img is None:
        return jsonify({"error": "No valid image provided in request"}), 400

    orig_width, orig_height = img.size

    # 2. Preprocess image
    input_tensor = IMAGE_TRANSFORM(img).unsqueeze(0).to(DEVICE)

    # 3. Real forward pass
    with torch.no_grad():
        logits = model(input_tensor)
        raw_probs = torch.softmax(logits, dim=1)[0].cpu().tolist()

    predicted_idx = int(torch.argmax(logits, dim=1)[0].item())
    pred_meta = CLASSES[predicted_idx]
    predicted_prob = raw_probs[predicted_idx]

    # 4. Generate dynamic Grad-CAM on layer features[16]
    input_for_cam = input_tensor.clone().detach()
    input_for_cam.requires_grad = True
    cam_np = compute_gradcam(model, input_for_cam, predicted_idx)

    # Render transparent RGBA Grad-CAM heatmap
    heatmap_rgba = colormap_to_rgba(cam_np, target_size=(orig_width, orig_height))
    heatmap_data_url = pil_to_base64_png(heatmap_rgba)

    # Also render blended composite (fundus + heatmap overlay)
    blended_img = img.copy()
    blended_img.paste(heatmap_rgba, (0, 0), heatmap_rgba)
    blended_data_url = pil_to_base64_png(blended_img)

    elapsed_ms = round((time.time() - start_time) * 1000, 1)

    # 5. Build 5-class distribution array
    class_distribution = []
    for cls_info in CLASSES:
        idx = cls_info["index"]
        prob = raw_probs[idx]
        class_distribution.append({
            "index": idx,
            "key": cls_info["key"],
            "label": cls_info["label"],
            "short_label": cls_info["short_label"],
            "dr_stage": cls_info["dr_stage"],
            "raw_probability": round(prob, 4),
            "percentage": round(prob * 100, 2),
            "is_predicted": idx == predicted_idx
        })

    # Diagnostic benchmark features for the predicted stage (ICDR Guidelines)
    stage_features = get_stage_associated_features(pred_meta["dr_stage"])

    response_payload = {
        "success": True,
        "predicted_index": predicted_idx,
        "predicted_label": pred_meta["label"],
        "dr_stage": pred_meta["dr_stage"],
        "clinical_name": pred_meta["clinical_name"],
        "icdr_grade": pred_meta["icdr_grade"],
        "severity_level": pred_meta["severity_level"],
        "model_probability": round(predicted_prob * 100, 2),
        "raw_probabilities": [round(p, 4) for p in raw_probs],
        "class_distribution": class_distribution,
        "gradcam_heatmap_url": heatmap_data_url,
        "gradcam_blended_url": blended_data_url,
        "image_dimensions": f"{orig_width} × {orig_height} px",
        "inference_time_ms": elapsed_ms,
        "model_version": "MobileNetV3-Large (mobilenetv3_dr.pth)",
        "explainability_engine": "Grad-CAM (Layer features[16] Conv2dNormActivation, 960 maps)",
        "is_live_inference": True,
        "inference_mode": "Live PyTorch Inference",
        "stage_associated_features": stage_features,
        "clinical_disclaimer": "The MobileNetV3 model performs deep convolutional screening and Grad-CAM attention localization according to the ICDR scale. Clinical verification by an ophthalmologist/retinal specialist is required."
    }

    return jsonify(response_payload)


def get_stage_associated_features(dr_stage):
    """
    Returns ICDR diagnostic reference criteria associated with the predicted stage.
    Clearly identifies these as benchmark stage-associated clinical characteristics,
    preserving medical rigor without false lesion detection claims.
    """
    if dr_stage == "No DR":
        return [
            {"name": "Microaneurysms", "icdr_expected": "None", "finding_status": "No microaneurysms characteristic of this stage."},
            {"name": "Hemorrhages", "icdr_expected": "None", "finding_status": "Normal vascular integrity expected."},
            {"name": "Hard Exudates", "icdr_expected": "None", "finding_status": "No lipid exudation observed in benchmark criteria."},
            {"name": "Cotton-Wool Spots", "icdr_expected": "None", "finding_status": "No nerve fiber layer infarcts expected."},
            {"name": "Neovascularization", "icdr_expected": "None", "finding_status": "Pre-retinal and disc vessels absent."}
        ]
    elif dr_stage == "Mild NPDR":
        return [
            {"name": "Microaneurysms", "icdr_expected": "Solitary / Few", "finding_status": "Microaneurysms only (hallmark criteria for ICDR Mild NPDR)."},
            {"name": "Hemorrhages", "icdr_expected": "None", "finding_status": "Absence of definite intraretinal hemorrhages."},
            {"name": "Hard Exudates", "icdr_expected": "None / Minimal", "finding_status": "Rare or negligible in early mild classification."},
            {"name": "Cotton-Wool Spots", "icdr_expected": "None", "finding_status": "No ischemic infarcts present in mild staging."},
            {"name": "Neovascularization", "icdr_expected": "None", "finding_status": "Absence of abnormal proliferative vessel growth."}
        ]
    elif dr_stage == "Moderate NPDR":
        return [
            {"name": "Microaneurysms", "icdr_expected": "Multiple", "finding_status": "Multiple microaneurysms in parafoveal / perimacular arcades."},
            {"name": "Hemorrhages", "icdr_expected": "Dot & Blot", "finding_status": "Intraretinal dot/blot hemorrhages (less than 4-2-1 severe rule)."},
            {"name": "Hard Exudates", "icdr_expected": "Present", "finding_status": "Lipid deposits secondary to breakdown of blood-retinal barrier."},
            {"name": "Cotton-Wool Spots", "icdr_expected": "Occasional", "finding_status": "Localized nerve fiber swelling may occur."},
            {"name": "Neovascularization", "icdr_expected": "None", "finding_status": "Strictly non-proliferative; no neovascularization at disc."}
        ]
    elif dr_stage == "Severe NPDR":
        return [
            {"name": "Microaneurysms & Hemorrhages", "icdr_expected": "Extensive", "finding_status": "4-2-1 Rule: >20 intraretinal hemorrhages in each of 4 quadrants."},
            {"name": "Venous Beading", "icdr_expected": "Prominent", "finding_status": "Definite venous caliber variations in ≥2 quadrants."},
            {"name": "IRMA (Intraretinal Abnormalities)", "icdr_expected": "Present", "finding_status": "Prominent microvascular remodeling in ≥1 quadrant."},
            {"name": "Cotton-Wool Spots", "icdr_expected": "Frequent", "finding_status": "Widespread axoplasmic transport disruption / infarcts."},
            {"name": "Neovascularization", "icdr_expected": "None", "finding_status": "Absence of frank preretinal neovascularization (high risk for progression)."}
        ]
    else: # PDR
        return [
            {"name": "Neovascularization (NVD/NVE)", "icdr_expected": "Definite / Extensive", "finding_status": "Abnormal vessel proliferation at optic disc or elsewhere in retina."},
            {"name": "Vitreous / Preretinal Hemorrhage", "icdr_expected": "Characteristic", "finding_status": "Vascular fragility causing pre-retinal or vitreal bleeding."},
            {"name": "Fibrous Proliferation", "icdr_expected": "Associated", "finding_status": "Fibrovascular membrane formation along posterior hyaloid."},
            {"name": "Microaneurysms & Exudates", "icdr_expected": "Widespread", "finding_status": "Advanced microvascular breakdown across retinal quadrants."},
            {"name": "Tractional Risk", "icdr_expected": "High Priority", "finding_status": "Urgent retinal evaluation for panretinal photocoagulation (PRP) or anti-VEGF."}
        ]


@app.route('/api/samples', methods=['GET'])
def list_samples():
    """Returns canonical demonstration sample fundus images."""
    samples = [
        {
            "class_index": 0,
            "label": "0 – No_DR",
            "dr_stage": "No DR",
            "filename": "sample_0_no_dr.jpg",
            "url": "/sample_fundus/sample_0_no_dr.jpg",
            "description": "Clear color fundus photograph with healthy macula, distinct optic disc cup, and intact vascular arcades."
        },
        {
            "class_index": 1,
            "label": "1 – Mild (Mild NPDR)",
            "dr_stage": "Mild NPDR",
            "filename": "sample_1_mild.jpg",
            "url": "/sample_fundus/sample_1_mild.jpg",
            "description": "Benchmark fundus exhibiting isolated microaneurysms in early non-proliferative retinopathy."
        },
        {
            "class_index": 2,
            "label": "2 – Moderate (Moderate NPDR)",
            "dr_stage": "Moderate NPDR",
            "filename": "sample_2_moderate.jpg",
            "url": "/sample_fundus/sample_2_moderate.jpg",
            "description": "Fundus displaying multiple parafoveal microaneurysms, dot/blot hemorrhages, and lipid exudates."
        },
        {
            "class_index": 3,
            "label": "3 – Severe (Severe NPDR)",
            "dr_stage": "Severe NPDR",
            "filename": "sample_3_severe.jpg",
            "url": "/sample_fundus/sample_3_severe.jpg",
            "description": "Advanced non-proliferative retinopathy with multi-quadrant blot hemorrhages and cotton-wool spots."
        },
        {
            "class_index": 4,
            "label": "4 – Proliferate_DR (PDR)",
            "dr_stage": "PDR",
            "filename": "sample_4_proliferate_dr.jpg",
            "url": "/sample_fundus/sample_4_proliferate_dr.jpg",
            "description": "Proliferative diabetic retinopathy showing neovascular vessels and severe microvascular changes."
        }
    ]
    return jsonify(samples)


if __name__ == '__main__':
    port = int(os.environ.get('PORT', 5000))
    print(f"============================================================")
    print(f" MobileNetV3 Diabetic Retinopathy Inference Microservice")
    print(f" Model: MobileNetV3-Large (mobilenetv3_dr.pth)")
    print(f" Device: {DEVICE}")
    print(f" Port: {port}")
    print(f" Healthcheck: http://localhost:{port}/api/health")
    print(f" Predict: POST http://localhost:{port}/api/predict")
    print(f"============================================================")
    app.run(host='0.0.0.0', port=port, debug=False)
