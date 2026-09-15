@echo off
title MobileNetV3 Diabetic Retinopathy Showcase Launcher
cls
echo =====================================================================
echo  MobileNetV3 Diabetic Retinopathy Clinical Screening Showcase
echo  Model: MobileNetV3-Large (mobilenetv3_dr.pth)
echo =====================================================================
echo.
echo [1/3] Starting Python PyTorch MobileNetV3 Inference Microservice...
start "MobileNetV3 Inference Server" cmd /k "python inference_server.py"

echo [2/3] Starting Vite Frontend Application Server...
start "Vite Frontend Server" cmd /k "npm run dev"

echo [3/3] Waiting for services to initialize...
timeout /t 3 /nobreak > nul

echo Launching Clinical Showcase in your browser...
start http://localhost:5173

echo.
echo =====================================================================
echo  Showcase is running!
echo  - Frontend: http://localhost:5173
echo  - ML Server: http://localhost:5000/api/health
echo =====================================================================
echo Keep both background terminal windows open during your demonstration.
pause
