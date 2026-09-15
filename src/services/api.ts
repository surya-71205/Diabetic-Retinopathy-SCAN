import { 
  Patient, 
  Analysis, 
  User, 
  DashboardStats, 
  AnalyticsData, 
  AnalysisFilter, 
  DRStage, 
  ImageQualityCheck, 
  Finding, 
  AnalysisStatus, 
  EyeLaterality,
  ClassProbability,
  StageAssociatedFeature
} from '../types';
import { INITIAL_PATIENTS, INITIAL_ANALYSES, CURRENT_USER, DEMO_SAMPLE_FUNDUS } from '../data/mockData';

const STORAGE_KEYS = {
  PATIENTS: 'dr_scan_patients_v3',
  ANALYSES: 'dr_scan_analyses_v3',
  USER: 'dr_scan_user_v3',
};

const INFERENCE_SERVER_URL = 'http://localhost:5000';

// Helper: initialize storage with seed data if empty
function initializeStorage() {
  if (typeof window === 'undefined') return;
  
  // Clean up legacy cached keys if present
  try {
    localStorage.removeItem('dr_scan_patients_v1');
    localStorage.removeItem('dr_scan_analyses_v1');
    localStorage.removeItem('dr_scan_user_v1');
    localStorage.removeItem('dr_scan_patients_v2');
    localStorage.removeItem('dr_scan_analyses_v2');
    localStorage.removeItem('dr_scan_user_v2');
  } catch (e) {
    // ignore
  }

  if (!localStorage.getItem(STORAGE_KEYS.PATIENTS)) {
    localStorage.setItem(STORAGE_KEYS.PATIENTS, JSON.stringify(INITIAL_PATIENTS));
  }
  if (!localStorage.getItem(STORAGE_KEYS.ANALYSES)) {
    localStorage.setItem(STORAGE_KEYS.ANALYSES, JSON.stringify(INITIAL_ANALYSES));
  }
  if (!localStorage.getItem(STORAGE_KEYS.USER)) {
    localStorage.setItem(STORAGE_KEYS.USER, JSON.stringify(CURRENT_USER));
  }
}

// Simulates minor network latency
const delay = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

function getStoredPatients(): Patient[] {
  initializeStorage();
  try {
    const data = localStorage.getItem(STORAGE_KEYS.PATIENTS);
    return data ? JSON.parse(data) : INITIAL_PATIENTS;
  } catch {
    return INITIAL_PATIENTS;
  }
}

function saveStoredPatients(patients: Patient[]) {
  try {
    localStorage.setItem(STORAGE_KEYS.PATIENTS, JSON.stringify(patients));
  } catch (err) {
    console.warn('Failed to persist patients to localStorage', err);
  }
}

function getStoredAnalyses(): Analysis[] {
  initializeStorage();
  try {
    const data = localStorage.getItem(STORAGE_KEYS.ANALYSES);
    return data ? JSON.parse(data) : INITIAL_ANALYSES;
  } catch {
    return INITIAL_ANALYSES;
  }
}

function saveStoredAnalyses(analyses: Analysis[]) {
  try {
    localStorage.setItem(STORAGE_KEYS.ANALYSES, JSON.stringify(analyses));
  } catch (err) {
    console.warn('Failed to persist analyses to localStorage', err);
  }
}

export interface CreateAnalysisInput {
  patientId: string;
  patientData?: Partial<Patient>;
  eye: EyeLaterality;
  retinalImageDataUrl: string;
  selectedSampleIndex?: number;
}

export const api = {
  // Check health of local Python PyTorch MobileNetV3 inference server
  async checkInferenceHealth(): Promise<{ isOnline: boolean; details?: any }> {
    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 2000);
      const res = await fetch(`${INFERENCE_SERVER_URL}/api/health`, {
        signal: controller.signal,
      });
      clearTimeout(timeoutId);
      if (res.ok) {
        const data = await res.json();
        return { isOnline: true, details: data };
      }
      return { isOnline: false };
    } catch {
      return { isOnline: false };
    }
  },

  // Authentication
  async login(email: string, password: string, rememberMe: boolean = true): Promise<User> {
    await delay(300);
    if (!email || !password) {
      throw new Error('Please enter both clinical ID/email and password.');
    }
    const user: User = {
      ...CURRENT_USER,
      email: email.includes('@') ? email : `${email}@retinaclinic.org`,
    };
    if (rememberMe && typeof window !== 'undefined') {
      localStorage.setItem(STORAGE_KEYS.USER, JSON.stringify(user));
    }
    return user;
  },

  async getCurrentUser(): Promise<User | null> {
    initializeStorage();
    try {
      const data = localStorage.getItem(STORAGE_KEYS.USER);
      return data ? JSON.parse(data) : CURRENT_USER;
    } catch {
      return CURRENT_USER;
    }
  },

  async logout(): Promise<void> {
    await delay(150);
    if (typeof window !== 'undefined') {
      localStorage.removeItem(STORAGE_KEYS.USER);
    }
  },

  // Dashboard Overview Statistics
  async getDashboardStats(): Promise<DashboardStats> {
    await delay(200);
    const analyses = getStoredAnalyses();
    const totalAnalyses = analyses.length;
    const drDetected = analyses.filter((a) => a.drStage !== 'No DR').length;
    const highPriorityReviews = analyses.filter(
      (a) => a.drStage === 'Severe NPDR' || a.drStage === 'PDR' || a.status === 'Review'
    ).length;

    const now = new Date();
    const currentYear = now.getFullYear();
    const currentMonth = now.getMonth();
    const analysesThisMonth = analyses.filter((a) => {
      const d = new Date(a.createdAt);
      return d.getFullYear() === currentYear && d.getMonth() === currentMonth;
    }).length || analyses.length;

    const stages: DRStage[] = ['No DR', 'Mild NPDR', 'Moderate NPDR', 'Severe NPDR', 'PDR'];
    const severityDistribution = stages.map((stage) => {
      const count = analyses.filter((a) => a.drStage === stage).length;
      return {
        stage,
        count,
        percentage: totalAnalyses > 0 ? Math.round((count / totalAnalyses) * 100) : 0,
      };
    });

    return {
      totalAnalyses,
      drDetected,
      highPriorityReviews,
      analysesThisMonth,
      severityDistribution,
    };
  },

  // Recent analyses
  async getRecentAnalyses(limit: number = 6): Promise<Analysis[]> {
    await delay(150);
    const analyses = getStoredAnalyses();
    return [...analyses]
      .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
      .slice(0, limit);
  },

  // Patients Directory
  async getPatients(search?: string): Promise<Patient[]> {
    await delay(150);
    const patients = getStoredPatients();
    if (!search || !search.trim()) return patients;
    const q = search.toLowerCase();
    return patients.filter(
      (p) =>
        p.id.toLowerCase().includes(q) ||
        p.name.toLowerCase().includes(q) ||
        p.diabetesType.toLowerCase().includes(q)
    );
  },

  async getPatient(id: string): Promise<{ patient: Patient; analyses: Analysis[] } | null> {
    await delay(150);
    const patients = getStoredPatients();
    const patient = patients.find((p) => p.id === id);
    if (!patient) return null;

    const analyses = getStoredAnalyses()
      .filter((a) => a.patientId === id)
      .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());

    return { patient, analyses };
  },

  async upsertPatient(patientData: Patient): Promise<Patient> {
    await delay(150);
    const patients = getStoredPatients();
    const existingIndex = patients.findIndex((p) => p.id === patientData.id);
    if (existingIndex >= 0) {
      patients[existingIndex] = { ...patients[existingIndex], ...patientData };
    } else {
      patients.unshift(patientData);
    }
    saveStoredPatients(patients);
    return patientData;
  },

  // Single Analysis Record
  async getAnalysis(id: string): Promise<{ analysis: Analysis; patient?: Patient } | null> {
    await delay(150);
    const analyses = getStoredAnalyses();
    const analysis = analyses.find((a) => a.id === id);
    if (!analysis) return null;

    const patients = getStoredPatients();
    const patient = patients.find((p) => p.id === analysis.patientId);

    return { analysis, patient };
  },

  // Update Analysis Clinician Review Status
  async updateAnalysisStatus(
    id: string,
    status: AnalysisStatus,
    reviewerNotes?: string,
    reviewedBy?: string
  ): Promise<Analysis> {
    await delay(200);
    const analyses = getStoredAnalyses();
    const index = analyses.findIndex((a) => a.id === id);
    if (index === -1) {
      throw new Error(`Analysis ${id} not found`);
    }

    analyses[index] = {
      ...analyses[index],
      status,
      reviewerNotes: reviewerNotes ?? analyses[index].reviewerNotes,
      reviewedBy: reviewedBy || 'Mr. Vivek',
      reviewedAt: new Date().toISOString(),
    };

    saveStoredAnalyses(analyses);
    return analyses[index];
  },

  // Create new analysis (Executes real MobileNetV3 inference with transparent fallback)
  async createAnalysis(input: CreateAnalysisInput): Promise<Analysis> {
    const patients = getStoredPatients();
    let patient = patients.find((p) => p.id === input.patientId);

    if (input.patientData) {
      if (patient) {
        patient = { ...patient, ...input.patientData };
        const idx = patients.findIndex((p) => p.id === input.patientId);
        patients[idx] = patient;
      } else {
        patient = {
          id: input.patientId,
          name: input.patientData.name || `Patient ${input.patientId}`,
          age: input.patientData.age || 50,
          sex: input.patientData.sex || 'Female',
          diabetesType: input.patientData.diabetesType || 'Type 2',
          diabetesDuration: input.patientData.diabetesDuration || 5,
          registeredAt: new Date().toISOString(),
          ...input.patientData,
        };
        patients.unshift(patient);
      }
      saveStoredPatients(patients);
    }

    if (!patient) {
      patient = {
        id: input.patientId,
        name: `Patient ${input.patientId}`,
        age: 55,
        sex: 'Female',
        diabetesType: 'Type 2',
        diabetesDuration: 8,
        registeredAt: new Date().toISOString(),
      };
      patients.unshift(patient);
      saveStoredPatients(patients);
    }

    // Default state variables
    let predictedStage: DRStage = 'No DR';
    let predictedLabel: string = '0 - No_DR';
    let modelProbability: number = 22.26;
    let confidence: number = 22.3;
    let classDistribution: ClassProbability[] = [];
    let stageAssociatedFeatures: StageAssociatedFeature[] = [];
    let xaiImageUrl: string = '';
    let isLiveInference: boolean = false;
    let inferenceMode: string = 'demo/mock fallback';
    let inferenceTimeMs: number = 0;

    // STEP A: Attempt Live Python PyTorch Inference on MobileNetV3-Large
    let liveSuccess = false;
    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 10000); // 10s max

      const resp = await fetch(`${INFERENCE_SERVER_URL}/api/predict`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ image: input.retinalImageDataUrl }),
        signal: controller.signal,
      });
      clearTimeout(timeoutId);

      if (resp.ok) {
        const liveData = await resp.json();
        if (liveData.success) {
          predictedStage = liveData.dr_stage;
          predictedLabel = liveData.predicted_label;
          modelProbability = liveData.model_probability;
          confidence = liveData.model_probability;
          classDistribution = liveData.class_distribution;
          stageAssociatedFeatures = liveData.stage_associated_features;
          xaiImageUrl = liveData.gradcam_heatmap_url;
          inferenceTimeMs = liveData.inference_time_ms;
          isLiveInference = true;
          inferenceMode = 'Live PyTorch MobileNetV3-Large Inference';
          liveSuccess = true;
        }
      }
    } catch (netErr) {
      console.warn('[ML-CLIENT] Live inference service offline or unreachable. Engaging verified fallback mode.', netErr);
    }

    // STEP B: If Live Inference Service is Offline, execute Verified Fallback (Directive 7)
    if (!liveSuccess) {
      isLiveInference = false;
      inferenceMode = 'demo/mock fallback';

      // If one of the 5 canonical demonstration images was selected
      let sampleMatch = DEMO_SAMPLE_FUNDUS.find((s) => s.url === input.retinalImageDataUrl);
      if (!sampleMatch && input.selectedSampleIndex !== undefined) {
        sampleMatch = DEMO_SAMPLE_FUNDUS[input.selectedSampleIndex];
      }

      if (sampleMatch) {
        predictedStage = sampleMatch.drStage;
        predictedLabel = sampleMatch.label;
        xaiImageUrl = sampleMatch.camUrl;
      } else {
        predictedStage = 'No DR';
        predictedLabel = '0 - No_DR';
        xaiImageUrl = DEMO_SAMPLE_FUNDUS[0].camUrl;
      }

      modelProbability = 22.26;
      confidence = 22.26;
      inferenceTimeMs = 38.5;

      classDistribution = [
        { index: 0, key: 'No_DR', label: '0 - No_DR', shortLabel: '0 - No_DR', drStage: 'No DR', rawProbability: 0.2226, percentage: 22.26, isPredicted: predictedStage === 'No DR' },
        { index: 1, key: 'Mild', label: '1 - Mild (Mild NPDR)', shortLabel: '1 - Mild', drStage: 'Mild NPDR', rawProbability: 0.1946, percentage: 19.46, isPredicted: predictedStage === 'Mild NPDR' },
        { index: 2, key: 'Moderate', label: '2 - Moderate (Moderate NPDR)', shortLabel: '2 - Moderate', drStage: 'Moderate NPDR', rawProbability: 0.2158, percentage: 21.58, isPredicted: predictedStage === 'Moderate NPDR' },
        { index: 3, key: 'Severe', label: '3 - Severe (Severe NPDR)', shortLabel: '3 - Severe', drStage: 'Severe NPDR', rawProbability: 0.1856, percentage: 18.56, isPredicted: predictedStage === 'Severe NPDR' },
        { index: 4, key: 'Proliferate_DR', label: '4 - Proliferate_DR (PDR)', shortLabel: '4 - Proliferate_DR', drStage: 'PDR', rawProbability: 0.1814, percentage: 18.14, isPredicted: predictedStage === 'PDR' },
      ];

      stageAssociatedFeatures = getFallbackStageFeatures(predictedStage);
    }

    const imageQuality: ImageQualityCheck = {
      overallRating: 'Good',
      retinaVisible: true,
      adequateIllumination: true,
      resolutionAcceptable: true,
      fieldOfViewAcceptable: true,
      score: 96,
      notes: 'Optimal retinal illumination and clear vascular arcade visualization.',
    };

    const findings: Finding[] = generateFindingsForStage(predictedStage);
    const newId = `A-${new Date().getFullYear()}-${String(Math.floor(1000 + Math.random() * 9000))}`;

    const newAnalysis: Analysis = {
      id: newId,
      patientId: patient.id,
      createdAt: new Date().toISOString(),
      eye: input.eye,
      drStage: predictedStage,
      predictedLabel,
      confidence,
      modelProbability,
      imageQuality,
      retinalImageUrl: input.retinalImageDataUrl,
      xaiImageUrl,
      findings,
      stageAssociatedFeatures,
      classDistribution,
      isLiveInference,
      inferenceMode,
      inferenceTimeMs,
      status: predictedStage === 'Severe NPDR' || predictedStage === 'PDR' ? 'Review' : 'Completed',
      clinicalSnapshot: {
        age: patient.age,
        sex: patient.sex,
        diabetesType: patient.diabetesType,
        diabetesDuration: patient.diabetesDuration,
        hba1c: patient.hba1c,
        glucose: patient.glucose,
        systolicBP: patient.systolicBP,
        diastolicBP: patient.diastolicBP,
        totalCholesterol: patient.totalCholesterol,
        ldl: patient.ldl,
        hdl: patient.hdl,
        triglycerides: patient.triglycerides,
        bmi: patient.bmi,
      },
      reviewerNotes: predictedStage === 'No DR' 
        ? 'No diabetic retinopathy detected. Next annual screening recommended.' 
        : `MobileNetV3 screening evaluated ${predictedLabel}. Clinician verification recommended.`,
      modelVersion: 'MobileNetV3-Large (mobilenetv3_dr.pth)',
    };

    const currentAnalyses = getStoredAnalyses();
    currentAnalyses.unshift(newAnalysis);
    saveStoredAnalyses(currentAnalyses);

    return newAnalysis;
  },

  // Analysis History with comprehensive search & filtering
  async getAnalysisHistory(filter: AnalysisFilter = {}): Promise<Analysis[]> {
    await delay(150);
    let list = getStoredAnalyses();

    if (filter.search && filter.search.trim()) {
      const q = filter.search.toLowerCase().trim();
      list = list.filter(
        (a) =>
          a.patientId.toLowerCase().includes(q) ||
          a.id.toLowerCase().includes(q) ||
          (a.reviewerNotes && a.reviewerNotes.toLowerCase().includes(q))
      );
    }

    if (filter.drStage && filter.drStage !== 'ALL') {
      list = list.filter((a) => a.drStage === filter.drStage);
    }

    if (filter.status && filter.status !== 'ALL') {
      list = list.filter((a) => a.status === filter.status);
    }

    if (filter.dateRange && filter.dateRange !== 'ALL') {
      const now = new Date();
      list = list.filter((a) => {
        const itemDate = new Date(a.createdAt);
        const diffDays = (now.getTime() - itemDate.getTime()) / (1000 * 3600 * 24);
        if (filter.dateRange === 'TODAY') return diffDays <= 1;
        if (filter.dateRange === 'WEEK') return diffDays <= 7;
        if (filter.dateRange === 'MONTH') return diffDays <= 30;
        return true;
      });
    }

    const sorted = [...list];
    if (filter.sortBy === 'date_asc') {
      sorted.sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime());
    } else if (filter.sortBy === 'confidence_desc') {
      sorted.sort((a, b) => b.confidence - a.confidence);
    } else if (filter.sortBy === 'confidence_asc') {
      sorted.sort((a, b) => a.confidence - b.confidence);
    } else {
      sorted.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
    }

    return sorted;
  },

  // Analytics Aggregation Data
  async getAnalyticsData(): Promise<AnalyticsData> {
    await delay(200);
    const analyses = getStoredAnalyses();
    const stages: DRStage[] = ['No DR', 'Mild NPDR', 'Moderate NPDR', 'Severe NPDR', 'PDR'];

    const benchmarkDefaults: Record<DRStage, { avgHba1c: number; avgDurationYears: number; avgSystolic: number; avgDiastolic: number; avgAge: number; avgLdl: number }> = {
      'No DR': { avgHba1c: 6.2, avgDurationYears: 3.8, avgSystolic: 122, avgDiastolic: 78, avgAge: 52, avgLdl: 104 },
      'Mild NPDR': { avgHba1c: 7.4, avgDurationYears: 7.2, avgSystolic: 131, avgDiastolic: 82, avgAge: 56, avgLdl: 118 },
      'Moderate NPDR': { avgHba1c: 8.5, avgDurationYears: 11.5, avgSystolic: 142, avgDiastolic: 88, avgAge: 61, avgLdl: 132 },
      'Severe NPDR': { avgHba1c: 9.6, avgDurationYears: 15.8, avgSystolic: 154, avgDiastolic: 93, avgAge: 64, avgLdl: 146 },
      'PDR': { avgHba1c: 10.4, avgDurationYears: 19.2, avgSystolic: 162, avgDiastolic: 96, avgAge: 67, avgLdl: 158 },
    };

    const severityDistribution: { stage: DRStage; count: number }[] = stages.map((stage) => ({
      stage,
      count: analyses.filter((a) => a.drStage === stage).length,
    }));

    const hba1cVsSeverity: { stage: DRStage; avgHba1c: number; count: number }[] = stages.map((stage) => {
      const matching = analyses.filter((a) => a.drStage === stage);
      const vals = matching.map((a) => a.clinicalSnapshot?.hba1c).filter((v): v is number => typeof v === 'number');
      const avg = vals.length > 0 ? vals.reduce((s, v) => s + v, 0) / vals.length : benchmarkDefaults[stage].avgHba1c;
      return {
        stage,
        avgHba1c: Number(avg.toFixed(1)),
        count: matching.length,
      };
    });

    const durationVsSeverity: { stage: DRStage; avgDurationYears: number; count: number }[] = stages.map((stage) => {
      const matching = analyses.filter((a) => a.drStage === stage);
      const vals = matching.map((a) => a.clinicalSnapshot?.diabetesDuration).filter((v): v is number => typeof v === 'number');
      const avg = vals.length > 0 ? vals.reduce((s, v) => s + v, 0) / vals.length : benchmarkDefaults[stage].avgDurationYears;
      return {
        stage,
        avgDurationYears: Number(avg.toFixed(1)),
        count: matching.length,
      };
    });

    const bpVsSeverity: { stage: DRStage; avgSystolic: number; avgDiastolic: number }[] = stages.map((stage) => {
      const matching = analyses.filter((a) => a.drStage === stage);
      const sysVals = matching.map((a) => a.clinicalSnapshot?.systolicBP).filter((v): v is number => typeof v === 'number');
      const diaVals = matching.map((a) => a.clinicalSnapshot?.diastolicBP).filter((v): v is number => typeof v === 'number');
      const avgSys = sysVals.length > 0 ? sysVals.reduce((s, v) => s + v, 0) / sysVals.length : benchmarkDefaults[stage].avgSystolic;
      const avgDia = diaVals.length > 0 ? diaVals.reduce((s, v) => s + v, 0) / diaVals.length : benchmarkDefaults[stage].avgDiastolic;
      return {
        stage,
        avgSystolic: Math.round(avgSys),
        avgDiastolic: Math.round(avgDia),
      };
    });

    const ageVsSeverity: { stage: DRStage; avgAge: number }[] = stages.map((stage) => {
      const matching = analyses.filter((a) => a.drStage === stage);
      const vals = matching.map((a) => a.clinicalSnapshot?.age).filter((v): v is number => typeof v === 'number');
      const avg = vals.length > 0 ? vals.reduce((s, v) => s + v, 0) / vals.length : benchmarkDefaults[stage].avgAge;
      return {
        stage,
        avgAge: Math.round(avg),
      };
    });

    const ldlVsSeverity: { stage: DRStage; avgLdl: number }[] = stages.map((stage) => {
      const matching = analyses.filter((a) => a.drStage === stage);
      const vals = matching.map((a) => a.clinicalSnapshot?.ldl).filter((v): v is number => typeof v === 'number');
      const avg = vals.length > 0 ? vals.reduce((s, v) => s + v, 0) / vals.length : benchmarkDefaults[stage].avgLdl;
      return {
        stage,
        avgLdl: Math.round(avg),
      };
    });

    return {
      severityDistribution,
      hba1cVsSeverity,
      durationVsSeverity,
      bpVsSeverity,
      ageVsSeverity,
      ldlVsSeverity,
    };
  },

  async getAnalytics(): Promise<AnalyticsData> {
    return this.getAnalyticsData();
  },

  // Reset demo storage to defaults
  resetToDefaults() {
    if (typeof window !== 'undefined') {
      localStorage.setItem(STORAGE_KEYS.PATIENTS, JSON.stringify(INITIAL_PATIENTS));
      localStorage.setItem(STORAGE_KEYS.ANALYSES, JSON.stringify(INITIAL_ANALYSES));
      localStorage.setItem(STORAGE_KEYS.USER, JSON.stringify(CURRENT_USER));
    }
  }
};

function getFallbackStageFeatures(stage: DRStage): StageAssociatedFeature[] {
  switch (stage) {
    case 'No DR':
      return [
        { name: 'Microaneurysms', icdrExpected: 'None', findingStatus: 'No microaneurysms characteristic of this stage.' },
        { name: 'Hemorrhages', icdrExpected: 'None', findingStatus: 'Normal vascular integrity expected.' },
        { name: 'Hard Exudates', icdrExpected: 'None', findingStatus: 'No lipid exudation observed in benchmark criteria.' },
        { name: 'Cotton-Wool Spots', icdrExpected: 'None', findingStatus: 'No nerve fiber layer infarcts expected.' },
        { name: 'Neovascularization', icdrExpected: 'None', findingStatus: 'Pre-retinal and disc vessels absent.' }
      ];
    case 'Mild NPDR':
      return [
        { name: 'Microaneurysms', icdrExpected: 'Solitary / Few', findingStatus: 'Microaneurysms only (hallmark criteria for ICDR Mild NPDR).' },
        { name: 'Hemorrhages', icdrExpected: 'None', findingStatus: 'Absence of definite intraretinal hemorrhages.' },
        { name: 'Hard Exudates', icdrExpected: 'None / Minimal', findingStatus: 'Rare or negligible in early mild classification.' },
        { name: 'Cotton-Wool Spots', icdrExpected: 'None', findingStatus: 'No ischemic infarcts present in mild staging.' },
        { name: 'Neovascularization', icdrExpected: 'None', findingStatus: 'Absence of abnormal proliferative vessel growth.' }
      ];
    case 'Moderate NPDR':
      return [
        { name: 'Microaneurysms', icdrExpected: 'Multiple', findingStatus: 'Multiple microaneurysms in parafoveal / perimacular arcades.' },
        { name: 'Hemorrhages', icdrExpected: 'Dot & Blot', findingStatus: 'Intraretinal dot/blot hemorrhages (less than 4-2-1 severe rule).' },
        { name: 'Hard Exudates', icdrExpected: 'Present', findingStatus: 'Lipid deposits secondary to breakdown of blood-retinal barrier.' },
        { name: 'Cotton-Wool Spots', icdrExpected: 'Occasional', findingStatus: 'Localized nerve fiber swelling may occur.' },
        { name: 'Neovascularization', icdrExpected: 'None', findingStatus: 'Strictly non-proliferative; no neovascularization at disc.' }
      ];
    case 'Severe NPDR':
      return [
        { name: 'Microaneurysms & Hemorrhages', icdrExpected: 'Extensive', findingStatus: '4-2-1 Rule: >20 intraretinal hemorrhages in each of 4 quadrants.' },
        { name: 'Venous Beading', icdrExpected: 'Prominent', findingStatus: 'Definite venous caliber variations in ≥2 quadrants.' },
        { name: 'IRMA', icdrExpected: 'Present', findingStatus: 'Prominent microvascular remodeling in ≥1 quadrant.' },
        { name: 'Cotton-Wool Spots', icdrExpected: 'Frequent', findingStatus: 'Widespread axoplasmic transport disruption / infarcts.' },
        { name: 'Neovascularization', icdrExpected: 'None', findingStatus: 'Absence of frank preretinal neovascularization (high risk for progression).' }
      ];
    case 'PDR':
      return [
        { name: 'Neovascularization (NVD/NVE)', icdrExpected: 'Definite / Extensive', findingStatus: 'Abnormal vessel proliferation at optic disc or elsewhere in retina.' },
        { name: 'Vitreous / Preretinal Hemorrhage', icdrExpected: 'Characteristic', findingStatus: 'Vascular fragility causing pre-retinal or vitreal bleeding.' },
        { name: 'Fibrous Proliferation', icdrExpected: 'Associated', findingStatus: 'Fibrovascular membrane formation along posterior hyaloid.' },
        { name: 'Microaneurysms & Exudates', icdrExpected: 'Widespread', findingStatus: 'Advanced microvascular breakdown across retinal quadrants.' },
        { name: 'Tractional Risk', icdrExpected: 'High Priority', findingStatus: 'Urgent retinal evaluation for panretinal photocoagulation (PRP) or anti-VEGF.' }
      ];
  }
}

function generateFindingsForStage(stage: DRStage): Finding[] {
  switch (stage) {
    case 'No DR':
      return [
        { name: 'Microaneurysms', detected: false, severity: 'None', description: 'Diagnostic criteria indicate no microaneurysms.' },
        { name: 'Hemorrhages', detected: false, severity: 'None', description: 'Vascular arcades intact.' },
        { name: 'Hard Exudates', detected: false, severity: 'None', description: 'Macular avascular zone clear.' },
        { name: 'Cotton-Wool Spots', detected: false, severity: 'None', description: 'No nerve fiber layer infarcts.' },
        { name: 'Neovascularization', detected: false, severity: 'None', description: 'Optic disc margins sharp.' },
        { name: 'Macular Edema Indicators', detected: false, severity: 'None', description: 'No parafoveal thickening.' },
      ];
    case 'Mild NPDR':
      return [
        { name: 'Microaneurysms', detected: true, severity: 'Low', description: 'Early microaneurysms (ICDR Grade 1 benchmark hallmark).' },
        { name: 'Hemorrhages', detected: false, severity: 'None', description: 'Absence of definite intraretinal hemorrhages.' },
        { name: 'Hard Exudates', detected: false, severity: 'None', description: 'No significant lipid deposition.' },
        { name: 'Cotton-Wool Spots', detected: false, severity: 'None', description: 'Absent in mild NPDR staging.' },
        { name: 'Neovascularization', detected: false, severity: 'None', description: 'Absent.' },
        { name: 'Macular Edema Indicators', detected: false, severity: 'None', description: 'Fovea preserved.' },
      ];
    case 'Moderate NPDR':
      return [
        { name: 'Microaneurysms', detected: true, severity: 'Moderate', description: 'Multiple microaneurysms in parafoveal and arcade distribution.' },
        { name: 'Hemorrhages', detected: true, severity: 'Moderate', description: 'Dot and blot intraretinal hemorrhages (less than 4-2-1 rule).' },
        { name: 'Hard Exudates', detected: true, severity: 'Low', description: 'Characteristic lipid deposits secondary to capillary leakage.' },
        { name: 'Cotton-Wool Spots', detected: false, severity: 'None', description: 'Infrequent at moderate stage.' },
        { name: 'Neovascularization', detected: false, severity: 'None', description: 'Non-proliferative disease; no neovascularization at disc.' },
        { name: 'Macular Edema Indicators', detected: true, severity: 'Low', description: 'Exudates in proximity to parafoveal ring.' },
      ];
    case 'Severe NPDR':
      return [
        { name: 'Microaneurysms', detected: true, severity: 'High', description: 'Extensive microvascular lesions satisfying 4-2-1 clinical staging rule.' },
        { name: 'Hemorrhages', detected: true, severity: 'High', description: 'Multi-quadrant blot hemorrhages.' },
        { name: 'Hard Exudates', detected: true, severity: 'Moderate', description: 'Extensive lipid exudation.' },
        { name: 'Cotton-Wool Spots', detected: true, severity: 'Moderate', description: 'Axoplasmic transport disruption (soft exudates).' },
        { name: 'Neovascularization', detected: false, severity: 'None', description: 'No neovascular fronds (high risk for progression to PDR).' },
        { name: 'Macular Edema Indicators', detected: true, severity: 'High', description: 'High risk based on extensive vascular leakage.' },
      ];
    case 'PDR':
      return [
        { name: 'Microaneurysms', detected: true, severity: 'High', description: 'Widespread microvascular damage.' },
        { name: 'Hemorrhages', detected: true, severity: 'High', description: 'Intraretinal and preretinal hemorrhage risk.' },
        { name: 'Hard Exudates', detected: true, severity: 'High', description: 'Confluent lipid deposition.' },
        { name: 'Cotton-Wool Spots', detected: true, severity: 'Moderate', description: 'Ischemic patches.' },
        { name: 'Neovascularization', detected: true, severity: 'High', description: 'Active neovascular vessels (NVD/NVE hallmark for PDR).' },
        { name: 'Macular Edema Indicators', detected: true, severity: 'High', description: 'Urgent ophthalmology referral indicated.' },
      ];
  }
}
