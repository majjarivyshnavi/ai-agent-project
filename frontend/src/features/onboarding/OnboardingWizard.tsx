import React, { useState, useEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import {
    Building,
    MapPin,
    ArrowLeft,
    CheckCircle2,
    ShieldCheck,
    Plus,
    Wand2,
    Clock,
    ArrowRight,
    Package,
    Mic,
    CreditCard,
    FileText,
    KeyRound
} from 'lucide-react';
import { Link, useNavigate } from 'react-router-dom';
import axios from 'axios';
import config from '../../config';
import { useMSE } from '../../context/MSEContext';
import { useAuth } from '../../context/AuthContext';
import type { OCRDocument } from '../../types';

const STEP_CREDENTIALS = 1;
const STEP_BASICS = 2;
const STEP_LOCATION = 3;
const STEP_DOCUMENTS = 4;
const STEP_PRODUCTS = 5;
const STEP_SUCCESS = 6;

interface OnboardingData {
    name: string;
    contact_person: string;
    email: string;
    phone: string;
    description: string;
    sector: string;
    address: string;
    city: string;
    state: string;
    pincode: string;
}

export default function OnboardingWizard() {
    const { t, i18n } = useTranslation();
    const { selectedMseId, setSelectedMseId, refreshMses, mses } = useMSE();
    const { isAuthenticated, login } = useAuth();
    const navigate = useNavigate();

    // Persistence Logic (FORM-01)
    const [step, setStep] = useState(() => {
        const saved = localStorage.getItem('onboarding_step');
        if (isAuthenticated) return STEP_LOCATION;
        return saved ? Number(saved) : STEP_CREDENTIALS;
    });

    const [formData, setFormData] = useState<OnboardingData>(() => {
        const saved = localStorage.getItem('onboarding_data');
        return saved ? JSON.parse(saved) : {
            name: '',
            contact_person: '',
            email: '',
            phone: '',
            description: '',
            sector: '',
            address: '',
            city: '',
            state: '',
            pincode: '',
        };
    });

    const [password, setPassword] = useState(() => localStorage.getItem('onboarding_pass') || '');
    const [confirmPassword, setConfirmPassword] = useState('');

    useEffect(() => {
        localStorage.setItem('onboarding_data', JSON.stringify(formData));
        localStorage.setItem('onboarding_step', step.toString());
        localStorage.setItem('onboarding_pass', password);
    }, [formData, step, password]);

    useEffect(() => {
        if (isAuthenticated && mses.length > 0 && selectedMseId) {
            const currentMse = mses.find(m => m.mse_id === selectedMseId);
            if (currentMse) {
                setFormData(prev => ({
                    ...prev,
                    name: currentMse.name || prev.name,
                    contact_person: currentMse.contact_person || prev.contact_person,
                    email: currentMse.email || prev.email,
                    phone: currentMse.phone || prev.phone,
                    description: currentMse.description || prev.description,
                    sector: currentMse.sector || prev.sector,
                    address: currentMse.address || prev.address,
                    city: currentMse.city || prev.city,
                    state: currentMse.state || prev.state,
                    pincode: currentMse.pincode || prev.pincode,
                }));
            }
        }
    }, [isAuthenticated, mses, selectedMseId]);

    const clearPersistence = () => {
        localStorage.removeItem('onboarding_data');
        localStorage.removeItem('onboarding_step');
        localStorage.removeItem('onboarding_pass');
    };

    const [loading, setLoading] = useState(false);
    const [isListening, setIsListening] = useState(false);
    const [initialLoading, setInitialLoading] = useState(isAuthenticated);
    
    const mediaRecorder = useRef<MediaRecorder | null>(null);
    const audioChunks = useRef<Blob[]>([]);

    const handleVoiceStart = async () => {
        try {
            const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
            const recorder = new MediaRecorder(stream,{mimeType:'audio/webm'});
            mediaRecorder.current = recorder;
            audioChunks.current = [];

            recorder.ondataavailable = (e) => {
                if (e.data.size > 0) audioChunks.current.push(e.data);
            };

            recorder.onstop = async () => {
                const audioBlob = new Blob(audioChunks.current, { type: 'audio/webm' });
                const formData = new FormData();
                formData.append('file', audioBlob, 'recording.webm');

                try {
                    // 1. Transcribe Audio
                    const transcribeRes = await axios.post(`${config.API_BASE_URL}/ai/transcribe`, formData);
                    const transcript = transcribeRes.data.transcript;

                    // 2. Parse entities from transcript
                    const res = await axios.post(`${config.API_BASE_URL}/mses/parse-voice`, { transcript });
                    const {
                        name,
                        contact_person,
                        phone,
                        email,
                        description,
                        sector,
                        address,
                        city,
                        state,
                        pincode
                    } = res.data;
                    setFormData((prev: OnboardingData) => ({
                        ...prev,
                        name: name || prev.name,
                        contact_person: contact_person || prev.contact_person,
                        phone: phone || prev.phone,
                        email: email || prev.email,
                        description: description || prev.description,
                        sector: sector || prev.sector,
                        address: address || prev.address,
                        city: city || prev.city,
                        state: state || prev.state,
                        pincode: pincode || prev.pincode
                    }));
                } catch (err) {
                    console.error("Voice processing failed", err);
                } finally {
                    setIsListening(false);
                    // Stop all tracks
                    stream.getTracks().forEach(track => track.stop());
                }
            };

            recorder.start();
            setIsListening(true);
        } catch (err) {
            console.error("Microphone access denied", err);
            alert("Microphone access is required for voice onboarding.");
        }
    };

    const handleVoiceStop = () => {
        if (mediaRecorder.current && isListening) {
            mediaRecorder.current.stop();
        }
    };
    
    const [documents, setDocuments] = useState<{
        type: string;
        fileName: string;
        status: 'pending' | 'uploading' | 'processing' | 'completed' | 'error' | 'needs_review';
        ocrData?: any;
        confidence?: number;
    }[]>([]);

    useEffect(() => {
        const checkStatus = async () => {
            if (!isAuthenticated || !selectedMseId) {
                setInitialLoading(false);
                return;
            }

            try {
                // 1. Fetch Documents
                const docsRes = await axios.get(`${config.API_BASE_URL}/documents/?mse_id=${selectedMseId}`);
                const userDocs = docsRes.data;
                
                // 2. Fetch Products
                const productsRes = await axios.get(`${config.API_BASE_URL}/products/${selectedMseId}/products`);
                const userProducts = productsRes.data;

                // Determine next step
                const currentMse = mses.find(m => m.mse_id === selectedMseId);
                const hasProfile = currentMse && currentMse.name && currentMse.address && currentMse.sector;
                const hasDocs = userDocs.length >= 2;
                const hasProducts = userProducts.length >= 1;

                if (hasProfile && hasDocs && hasProducts) {
                    setStep(STEP_SUCCESS);
                } else if (!hasProfile) {
                    setStep(STEP_LOCATION);
                } else if (!hasDocs) {
                    setStep(STEP_DOCUMENTS);
                    if (userDocs.length > 0) {
                        setDocuments(userDocs.map((d: any) => ({
                            type: d.document_type,
                            fileName: 'Previously Uploaded',
                            status: d.ocr_status === 'completed' ? (d.confidence_score < 0.7 ? 'needs_review' : 'completed') : d.ocr_status,
                            confidence: d.confidence_score
                        })));
                    }
                } else {
                    setStep(STEP_PRODUCTS);
                }
                
                // Sync local mseId with context for uploads
                setMseId(selectedMseId);
            } catch (err) {
                console.error("Failed to check onboarding status", err);
            } finally {
                setInitialLoading(false);
            }
        };

        checkStatus();
    }, [isAuthenticated, selectedMseId, mses]);

    const [productData, setProductData] = useState({
        product_name: '',
        description: '',
        price: '',
        unit: 'pcs',
        category_id: null as number | null,
        category_name: '',
        attributes: null as string | null
    });

    const [suggestions, setSuggestions] = useState<any[]>([]);
    const [productErrors, setProductErrors] = useState<Record<string, string>>({});

    const validateProduct = () => {
        const errs: Record<string, string> = {};
        if (!productData.product_name.trim()) errs.product_name = 'Product name is required';
        if (!productData.description.trim()) errs.description = 'Description is required for AI categorization';
        if (!productData.price || Number(productData.price) <= 0) errs.price = 'Price must be greater than 0';
        setProductErrors(errs);
        return Object.keys(errs).length === 0;
    };
    const [mseId, setMseId] = useState<number | null>(null);
    const abortControllers = useRef<AbortController[]>([]);

    useEffect(() => {
        return () => {
            abortControllers.current.forEach(ac => ac.abort());
        };
    }, []);

    useEffect(() => {
        abortControllers.current.forEach(ac => ac.abort());
        abortControllers.current = [];
    }, [step]);

    const [errors, setErrors] = useState<Record<string, string>>({});

    const validateField = (name: string, value: string) => {
        let error = '';
        const trimmed = value?.trim() || '';
        
        if (name === 'email') {
            if (!trimmed) error = 'Email is required';
            else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(trimmed)) error = 'Invalid email format';
        } else if (name === 'phone') {
            if (!trimmed) error = 'Phone is required';
            else if (!/^[6-9]\d{9}$/.test(trimmed)) error = 'Must be a 10-digit Indian mobile number';
        } else if (name === 'pincode') {
            if (!trimmed) error = 'Pincode is required';
            else if (!/^\d{6}$/.test(trimmed)) error = 'Must be a 6-digit pincode';
        } else if (['name', 'contact_person', 'address', 'city', 'state', 'sector'].includes(name)) {
            if (!trimmed) error = `${name.replace('_', ' ')} is required`.replace(/^\w/, c => c.toUpperCase());
        }
        
        setErrors(prev => ({ ...prev, [name]: error }));
        return !error;
    };

    const validateStep = (currentStep: number) => {
        const errs: Record<string, string> = {};
        
        if (currentStep === STEP_CREDENTIALS) {
            if (!formData.email.trim()) errs.email = 'Email is required';
            else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(formData.email.trim())) errs.email = 'Invalid email format';
            
            if (!formData.phone.trim()) errs.phone = 'Phone is required';
            else if (!/^[6-9]\d{9}$/.test(formData.phone.trim())) errs.phone = 'Must be a 10-digit Indian mobile number';
            
            if (password.length < 8) errs.password = 'Password must be at least 8 characters';
            else if (password !== confirmPassword) errs.password = 'Passwords do not match';
        } else if (currentStep === STEP_BASICS) {
            if (!formData.name.trim()) errs.name = 'Enterprise name is required';
            if (!formData.contact_person.trim()) errs.contact_person = 'Authorized official is required';
        } else if (currentStep === STEP_LOCATION) {
            if (!formData.sector) errs.sector = 'Sector is required';
            if (!formData.address.trim()) errs.address = 'Address is required';
            if (!formData.city.trim()) errs.city = 'City is required';
            if (!formData.state.trim()) errs.state = 'State is required';
            if (!formData.pincode.trim()) errs.pincode = 'Pincode is required';
            else if (!/^\d{6}$/.test(formData.pincode.trim())) errs.pincode = 'Must be a 6-digit pincode';
        }
        
        setErrors(errs);
        return Object.keys(errs).length === 0;
    };

    const handleChange = (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>) => {
        const { name, value } = e.target;
        setFormData((prev: OnboardingData) => ({ ...prev, [name]: value }));
        if (errors[name] !== undefined) validateField(name, value);
    };

    const handleCreateAccount = async () => {
        if (!validateStep(STEP_CREDENTIALS)) return;
        setStep(STEP_BASICS);
    };

    const canGoNext = (currentStep: number) => {
        if (currentStep === STEP_CREDENTIALS) {
            return formData.email.trim() && formData.phone.trim() && password.length >= 8 && password === confirmPassword && !errors.email && !errors.phone;
        }
        if (currentStep === STEP_BASICS) {
            return formData.name.trim() && formData.contact_person.trim() && !errors.name && !errors.contact_person;
        }
        if (currentStep === STEP_LOCATION) {
            return formData.sector && formData.address.trim() && formData.city.trim() && formData.state.trim() && formData.pincode.trim() && !errors.pincode;
        }
        if (currentStep === STEP_DOCUMENTS) {
            return documents.filter(d => d.status === 'completed' || d.status === 'needs_review').length >= 2;
        }
        return true;
    };

    const FormError = ({ message }: { message?: React.ReactNode }) => (
        message ? <div className="text-red-500 text-[10px] font-bold mt-1 ml-1">{message}</div> : null
    );

    const handleVoiceSimulation = () => {
    const SpeechRecognition =
        (window as any).SpeechRecognition ||
        (window as any).webkitSpeechRecognition;

    if (!SpeechRecognition) {
        alert("Voice recognition is not supported in this browser. Please use Chrome or Edge.");
        return;
    }

    const recognition = new SpeechRecognition();
    recognition.lang = i18n.language === 'hi' ? 'hi-IN' : 'en-IN';
    recognition.interimResults = false;
    recognition.maxAlternatives = 1;

    setIsListening(true);
    recognition.start();

    recognition.onresult = async (event: any) => {
        const transcript = event.results[0][0].transcript;
        console.log("Voice transcript:", transcript);

        try {
            const res = await axios.post(`${config.API_BASE_URL}/mses/parse-voice`, { transcript });
            const { name, contact_person, phone, email, description ,sector,address,city,state,pincode} = res.data;

            setFormData((prev: OnboardingData) => ({
                ...prev,
                name: name || prev.name,
                contact_person: contact_person || prev.contact_person,
                phone: phone || prev.phone,
                email: email || prev.email,
                description: description || prev.description,
                sector:sector||prev.sector,
                address:address||prev.address,
                city:city||prev.city,
                state:state||prev.state,
                pincode:pincode||prev.pincode
            }));
        } catch (e) {
            console.error("NLP extraction failed", e);
            setFormData((prev: OnboardingData) => ({
                ...prev,
                description: transcript || prev.description
            }));
        } finally {
            setIsListening(false);
        }
    };

    recognition.onerror = (event: any) => {
        console.error("Speech recognition error:", event);
        setIsListening(false);
        alert("Voice recognition failed. Please try again.");
    };

    recognition.onend = () => {
        setIsListening(false);
    };
};
    const handleSubmit = async () => {
        setLoading(true);
        try {
            let res;
            const payload = {
                name: formData.name,
                contact_person: formData.contact_person,
                phone: formData.phone,
                address: formData.address,
                city: formData.city,
                state: formData.state,
                pincode: formData.pincode,
                sector: formData.sector || null,
                description: formData.description,
            };

            if (isAuthenticated) {
                if (selectedMseId) {
                    // Profile exists — update it
                    res = await axios.put(`${config.API_BASE_URL}/mses/${selectedMseId}`, {
                        ...payload,
                        email: formData.email, // PUT endpoint expects full MSESubmit schema
                        password: password || 'dummy_pass' // Keep existing or provide dummy for validation
                    });
                } else {
                    // No profile yet — create it
                    res = await axios.post(`${config.API_BASE_URL}/mses/profile`, payload);
                }
            } else {
                res = await axios.post(`${config.API_BASE_URL}/mses/register`, {
                    ...payload,
                    email: formData.email,
                    password
                });
            }
            
            const registrationData = res.data;
            const newMseId = isAuthenticated 
                ? (selectedMseId || registrationData.mse_id) 
                : registrationData.mse?.mse_id;
            
            if (!isAuthenticated && registrationData?.access_token) {
                const token = registrationData.access_token;
                localStorage.setItem('authToken', token);
                axios.defaults.headers.common['Authorization'] = `Bearer ${token}`;
                
                const profileId = registrationData.mse?.mse_id;
                const userId = registrationData.user?.id;
                login('mse', userId, token, profileId);
            }
            
            setMseId(newMseId);
            setSelectedMseId(newMseId);
            if (newMseId) localStorage.setItem('selectedMseId', newMseId.toString());
            await refreshMses();
            clearPersistence();
            setStep(STEP_DOCUMENTS);
        } catch (error: any) {
            if (!isAuthenticated && error.response?.status === 409) {
                setErrors(prev => ({ 
                    ...prev, 
                    email: (
                        <span>
                            This email is already registered. Please <Link to="/" className="underline text-blue-600">log in</Link>.
                        </span>
                    ) as any
                }));
                setStep(STEP_CREDENTIALS);
                return;
            }
            console.error(error);
            const detail = error.response?.data?.detail;
const errorMessage =
  typeof detail === 'string'
    ? detail
    : Array.isArray(detail)
    ? detail.map((d: any) => d.msg || JSON.stringify(d)).join(', ')
    : detail
    ? JSON.stringify(detail)
    : 'Failed to save business profile. Please try again.';

alert(errorMessage);
        } finally {
            setLoading(false);
        }
    };

    const handleNext = () => setStep(prev => prev + 1);
    const handlePrev = () => setStep(prev => prev - 1);

    const pollOcrStatus = async (docId: number, type: string) => {
        let attempts = 0;
        const maxAttempts = 10;
        const backoffSchedule = [3000, 6000, 12000];

        const controller = new AbortController();
        abortControllers.current.push(controller);

        const poll = async () => {
            if (controller.signal.aborted) return;
            
            try {
                const res = await axios.get(`${config.API_BASE_URL}/documents/${docId}/ocr-data`, {
                    signal: controller.signal
                });
                
                const doc: OCRDocument = res.data;
                if (doc.ocr_status === 'completed') {
                    abortControllers.current = abortControllers.current.filter(c => c !== controller);
                    
                    let parsedData = {};
                    try {
                        parsedData = doc.extracted_data ? JSON.parse(doc.extracted_data) : {};
                    } catch (e) {
                        console.error("OCR JSON Parse Error", e);
                    }

                    const status = (doc.confidence_score !== undefined && doc.confidence_score < 0.7) ? 'needs_review' : 'completed';

                    setDocuments(prev => prev.map(d => d.type === type ? {
                        ...d,
                        status: status,
                        ocrData: parsedData,
                        confidence: doc.confidence_score
                    } : d));
                    return;
                } 
                
                if (doc.ocr_status === 'failed' || attempts >= maxAttempts) {
                    abortControllers.current = abortControllers.current.filter(c => c !== controller);
                    setDocuments(prev => prev.map(d => d.type === type ? { ...d, status: 'error' } : d));
                    return;
                }

                // Exponential backoff or standard interval
                const delay = backoffSchedule[attempts] || 12000;
                attempts++;
                
                if (!controller.signal.aborted) {
                    setTimeout(poll, delay);
                }
            } catch (err: any) {
                if (err.name === 'CanceledError' || err.name === 'AbortError') return;
                
                console.error("OCR Polling Error", err);
                abortControllers.current = abortControllers.current.filter(c => c !== controller);
                setDocuments(prev => prev.map(d => d.type === type ? { ...d, status: 'error' } : d));
            }
        };

        poll();
    };

    const handleFileUpload = (type: string) => {
        if (!mseId) return;

        const input = document.createElement('input');
        input.type = 'file';
        input.accept = 'image/*,application/pdf';

        input.onchange = async (e: any) => {
            const file = e.target.files?.[0];
            if (!file) return;

            setDocuments(prev => [...prev.filter(d => d.type !== type), { type, fileName: file.name, status: 'uploading' }]);

            try {
                const form = new FormData();
                form.append('mse_id', mseId.toString());
                form.append('document_type', type);
                form.append('file', file);

                const res = await axios.post(`${config.API_BASE_URL}/documents/upload`, form);

                setDocuments(prev => prev.map(d => d.type === type ? {
                    ...d,
                    status: 'processing'
                } : d));

                pollOcrStatus(res.data.document_id, type);
            } catch (err) {
                console.error("OCR Initiation Failed", err);
                setDocuments(prev => prev.map(d => d.type === type ? {
                    ...d,
                    status: 'error'
                } : d));
            }
        };
        input.click();
    };

    const handleCategorize = async () => {
        if (!productData.description) return;
        setLoading(true);
        try {
            const res = await axios.post(`${config.API_BASE_URL}/products/categorize`, {
                product_name: productData.product_name,
                description: productData.description
            });
            setSuggestions(res.data.suggestions);
        } catch (err) {
            console.error(err);
        } finally {
            setLoading(false);
        }
    };

    const handleAddProduct = async () => {
        if (!mseId) return;
        if (!validateProduct()) return;
        setLoading(true);
        try {
            const dataToSubmit = {
                ...productData,
                mse_id: mseId,
                price: Number(productData.price)
            };
            await axios.post(`${config.API_BASE_URL}/products/${mseId}/products`, dataToSubmit);
            setStep(STEP_SUCCESS);
        } catch (err: any) {
            console.error(err);
            if (err.response?.status === 409) {
                setProductErrors({ product_name: err.response.data.detail || "Product already exists" });
            } else {
                alert("Failed to sync SKU to network.");
            }
        } finally {
            setLoading(false);
        }
    };

    if (initialLoading) {
        return (
            <div className="min-h-screen bg-[#fcfdfe] flex flex-col items-center justify-center py-20 px-4">
                <div className="w-16 h-16 border-4 border-slate-100 border-t-[#002147] rounded-full animate-spin mb-4" />
                <p className="text-slate-500 font-bold uppercase tracking-widest text-[10px]">Retrieving ONDC Onboarding Status...</p>
            </div>
        );
    }

    return (
        <div className="min-h-screen bg-[#fcfdfe] flex flex-col items-center py-20 px-4 font-sans relative overflow-hidden">
            {/* National Decorations */}
            <div className="fixed top-0 left-0 w-full h-2 bg-[#002147] z-50"></div>
            <div className="absolute top-1/4 -left-20 w-80 h-80 bg-orange-500/5 rounded-full blur-[80px] pointer-events-none"></div>
            <div className="absolute bottom-1/4 -right-20 w-80 h-80 bg-emerald-500/5 rounded-full blur-[80px] pointer-events-none"></div>

            <div className="w-full max-w-3xl bg-white rounded-3xl p-10 shadow-2xl border border-slate-200 relative overflow-hidden fade-in duration-700 z-10">

                <div className="mb-10 relative z-10 flex justify-between items-start">
                    <div>
                        <h2 className="text-3xl font-black text-[#002147] mb-2 uppercase tracking-tight">{t('onboarding_title')}</h2>
                        <p className="text-slate-500 text-sm font-medium">{t('onboarding_subtitle')}</p>
                    </div>
                </div>

                {step !== STEP_SUCCESS && (
                    <div className="mb-16 flex items-center justify-between relative px-2">
                        <div className="absolute left-0 top-1/2 -translate-y-1/2 w-full h-[1px] bg-slate-100 -z-10 mx-2"></div>
                        <div className="absolute left-0 top-1/2 -translate-y-1/2 h-[2px] bg-orange-600 -z-10 mx-2 transition-all duration-1000" style={{ width: `${((step - 1) / 4) * 100}%` }}></div>

                        {[
                            { s: STEP_CREDENTIALS, icon: KeyRound, label: 'Access' },
                            { s: STEP_BASICS, icon: Building, label: 'Identity' },
                            { s: STEP_LOCATION, icon: MapPin, label: 'Region' },
                            { s: STEP_DOCUMENTS, icon: ShieldCheck, label: 'Audit' },
                            { s: STEP_PRODUCTS, icon: Package, label: 'Catalogue' }
                        ].map((item) => (
                            <div key={item.s} className="flex flex-col items-center group">
                                <div className={`w-12 h-12 rounded-2xl flex items-center justify-center border transition-all duration-500 ${step >= item.s ? 'bg-[#002147] border-[#002147] text-white shadow-xl' : 'bg-white border-slate-200 text-slate-300'}`}>
                                    <item.icon size={20} />
                                </div>
                                <span className={`text-[9px] font-black mt-3 tracking-widest uppercase transition-colors ${step >= item.s ? 'text-[#002147]' : 'text-slate-300'}`}>{item.label}</span>
                            </div>
                        ))}
                    </div>
                )}

                <div className="relative z-10 min-h-[450px]">
                    {step === STEP_CREDENTIALS && (
                        <div className="space-y-8 fade-in duration-500">
                            <div className="grid grid-cols-1 gap-6">
                        <div className="space-y-1.5">
                            <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest ml-1">Official Email</label>
                            <input name="email" type="email" value={formData.email} onChange={handleChange} onBlur={() => validateField('email', formData.email)} className={`w-full bg-slate-50 border ${errors.email ? 'border-red-500' : 'border-slate-200'} rounded-xl px-4 py-3.5 text-slate-900 font-bold focus:border-[#002147] outline-none transition-all placeholder:text-slate-300`} placeholder="admin@enterprise.gov.in" />
                            <FormError message={errors.email} />
                        </div>
                        <div className="space-y-1.5">
                            <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest ml-1">Mobile Number</label>
                            <input name="phone" type="tel" value={formData.phone} onChange={handleChange} onBlur={() => validateField('phone', formData.phone)} className={`w-full bg-slate-50 border ${errors.phone ? 'border-red-500' : 'border-slate-200'} rounded-xl px-4 py-3.5 text-slate-900 font-bold focus:border-[#002147] outline-none transition-all placeholder:text-slate-300`} placeholder="+91 XXXXX XXXXX" />
                            <FormError message={errors.phone} />
                        </div>
                        <div className="space-y-1.5">
                            <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest ml-1">Password</label>
                            <input type="password" value={password} onChange={e => { setPassword(e.target.value); setErrors(prev => ({ ...prev, password: '' })); }} className={`w-full bg-slate-50 border ${errors.password ? 'border-red-500' : 'border-slate-200'} rounded-xl px-4 py-3.5 text-slate-900 font-bold focus:border-[#002147] outline-none transition-all placeholder:text-slate-300`} placeholder="Min. 8 characters" />
                            <FormError message={errors.password} />
                        </div>
                        <div className="space-y-1.5">
                            <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest ml-1">Confirm Password</label>
                            <input type="password" value={confirmPassword} onChange={e => { setConfirmPassword(e.target.value); setErrors(prev => ({ ...prev, password: '' })); }} className={`w-full bg-slate-50 border ${errors.password && confirmPassword !== password ? 'border-red-500' : 'border-slate-200'} rounded-xl px-4 py-3.5 text-slate-900 font-bold focus:border-[#002147] outline-none transition-all placeholder:text-slate-300`} placeholder="Repeat password" />
                        </div>
                    </div>

                            <div className="flex justify-end pt-6">
                                <button onClick={handleCreateAccount} disabled={loading || !formData.email || !formData.phone} className="bg-[#002147] hover:bg-[#003366] disabled:opacity-30 text-white px-10 py-4 rounded-xl font-black text-[10px] uppercase tracking-[0.2em] shadow-lg active:scale-95 transition-all flex items-center space-x-2">
                                    <span>{loading ? 'Creating Account...' : 'Create Account & Continue'}</span>
                                    <ArrowRight size={16} />
                                </button>
                            </div>
                        </div>
                    )}

                    {step === STEP_BASICS && (
                        <div className="space-y-8 fade-in duration-500">
                            <button
                                onClick={handleVoiceSimulation}
                                className={`w-full p-6 rounded-2xl border-2 border-dashed flex items-center justify-between transition-all ${isListening ? 'bg-orange-50 border-orange-600' : 'bg-slate-50 border-slate-200 hover:border-[#002147]/30 hover:bg-slate-100'}`}
                            >
                                <div className="flex items-center space-x-5">
                                    <div className={`w-12 h-12 rounded-xl flex items-center justify-center ${isListening ? 'bg-orange-600 animate-pulse text-white' : 'bg-[#002147] text-white shadow-sm'}`}>
                                        <Mic size={24} />
                                    </div>
                                    <div className="text-left">
                                        <h4 className="text-[#002147] font-black text-sm uppercase tracking-tight">AI Voice Assistant</h4>
                                        <p className="text-[11px] text-slate-500 font-medium">{isListening ? 'National Mission Voice Processing...' : 'Auto-fill form using voice (Hindi/English)'}</p>
                                    </div>
                                </div>
                                {isListening && (
                                    <div className="flex gap-1.5 px-4">
                                        {[1, 2, 3, 4].map(i => <div key={i} className="w-1.5 h-6 bg-orange-600 rounded-full animate-bounce" style={{ animationDelay: `${i * 0.15}s` }}></div>)}
                                    </div>
                                )}
                            </button>

                            <div className="grid grid-cols-1 gap-6">
                                <div className="space-y-1.5">
                                    <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest ml-1">Enterprise Name</label>
                                    <input name="name" value={formData.name} onChange={handleChange} className={`w-full bg-slate-50 border ${errors.name ? 'border-red-500' : 'border-slate-200'} rounded-xl px-4 py-3.5 text-slate-900 font-bold focus:border-[#002147] outline-none transition-all placeholder:text-slate-300`} placeholder="e.g. Bharat Textiles Ltd." />
                                    <FormError message={errors.name} />
                                </div>
                                <div className="space-y-1.5">
                                    <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest ml-1">Authorized Official</label>
                                    <input name="contact_person" value={formData.contact_person} onChange={handleChange} className={`w-full bg-slate-50 border ${errors.contact_person ? 'border-red-500' : 'border-slate-200'} rounded-xl px-4 py-3.5 text-slate-900 font-bold focus:border-[#002147] outline-none transition-all placeholder:text-slate-300`} placeholder="Full Name" />
                                    <FormError message={errors.contact_person} />
                                </div>
                                <div className="space-y-1.5">
                                    <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest ml-1">Business Objective</label>
                                    <textarea name="description" value={formData.description} onChange={handleChange} rows={3} className={`w-full bg-slate-50 border ${errors.description ? 'border-red-500' : 'border-slate-200'} rounded-xl px-4 py-3.5 text-slate-900 font-bold focus:border-[#002147] outline-none transition-all resize-none placeholder:text-slate-300`} placeholder="Provide a brief summary of your enterprise and products..." />
                                    <FormError message={errors.description} />
                                </div>
                            </div>

                            <div className="flex justify-between pt-6">
                                <button onClick={handlePrev} className="text-slate-400 hover:text-[#002147] font-black text-[10px] uppercase tracking-widest flex items-center space-x-2 transition-colors">
                                    <ArrowLeft size={16} />
                                    <span>Go Back</span>
                                </button>
                                <button onClick={handleNext} disabled={!formData.name} className="bg-[#002147] hover:bg-[#003366] disabled:opacity-30 text-white px-10 py-4 rounded-xl font-black text-[10px] uppercase tracking-[0.2em] shadow-lg active:scale-95 transition-all flex items-center space-x-2">
                                    <span>Save & Continue</span>
                                    <ArrowRight size={16} />
                                </button>
                            </div>
                        </div>
                    )}

                    {step === STEP_LOCATION && (
                        <div className="space-y-8 fade-in duration-500">
                            <div className="grid grid-cols-1 gap-6">
                                <div className="space-y-1.5">
                                    <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest ml-1">Industrial Sector</label>
                                    <select name="sector" value={formData.sector} onChange={handleChange} onBlur={(e) => validateField('sector', e.target.value)} className={`w-full bg-slate-50 border ${errors.sector ? 'border-red-500' : 'border-slate-200'} rounded-xl px-4 py-3.5 text-slate-900 font-bold focus:border-[#002147] outline-none transition-all`}>
                                        <option value="">Select Sector</option>
                                        <option value="Handicrafts">Handicrafts</option>
                                        <option value="Textiles">Textiles</option>
                                        <option value="Agri">Agri</option>
                                        <option value="Food Processing">Food Processing</option>
                                        <option value="Leather">Leather</option>
                                        <option value="Other">Other</option>
                                    </select>
                                    <FormError message={errors.sector} />
                                </div>
                                <div className="space-y-1.5">
                                    <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest ml-1">Registered Address</label>
                                    <input name="address" value={formData.address} onChange={handleChange} onBlur={(e) => validateField('address', e.target.value)} className={`w-full bg-slate-50 border ${errors.address ? 'border-red-500' : 'border-slate-200'} rounded-xl px-4 py-3.5 text-slate-900 font-bold focus:border-[#002147] outline-none transition-all placeholder:text-slate-300`} placeholder="Plot No., Building Name" />
                                    <FormError message={errors.address} />
                                </div>
                                <div className="grid grid-cols-2 gap-6">
                                    <div className="space-y-1.5">
                                        <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest ml-1">City</label>
                                        <input name="city" value={formData.city} onChange={handleChange} onBlur={(e) => validateField('city', e.target.value)} className={`w-full bg-slate-50 border ${errors.city ? 'border-red-500' : 'border-slate-200'} rounded-xl px-4 py-3.5 text-slate-900 font-bold focus:border-[#002147] outline-none transition-all placeholder:text-slate-300`} placeholder="City" />
                                        <FormError message={errors.city} />
                                    </div>
                                    <div className="space-y-1.5">
                                        <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest ml-1">State</label>
                                        <input name="state" value={formData.state} onChange={handleChange} onBlur={(e) => validateField('state', e.target.value)} className={`w-full bg-slate-50 border ${errors.state ? 'border-red-500' : 'border-slate-200'} rounded-xl px-4 py-3.5 text-slate-900 font-bold focus:border-[#002147] outline-none transition-all placeholder:text-slate-300`} placeholder="State" />
                                        <FormError message={errors.state} />
                                    </div>
                                </div>
                                <div className="space-y-1.5">
                                    <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest ml-1">Postal Pincode</label>
                                    <input name="pincode" value={formData.pincode} onChange={handleChange} onBlur={() => validateField('pincode', formData.pincode)} className={`w-full bg-slate-50 border ${errors.pincode ? 'border-red-500' : 'border-slate-200'} rounded-xl px-4 py-3.5 text-slate-900 font-bold focus:border-[#002147] outline-none transition-all placeholder:text-slate-300`} placeholder="6-digit PIN" />
                                    <FormError message={errors.pincode} />
                                </div>
                            </div>

                            <div className="flex justify-between pt-6">
                                <button onClick={handlePrev} className="text-slate-400 hover:text-[#002147] font-black text-[10px] uppercase tracking-widest flex items-center space-x-2 transition-colors">
                                    <ArrowLeft size={16} />
                                    <span>Go Back</span>
                                </button>
                                <button onClick={handleSubmit} disabled={loading} className="bg-orange-600 hover:bg-orange-700 text-white px-10 py-4 rounded-xl font-black text-[10px] uppercase tracking-[0.2em] shadow-lg active:scale-95 transition-all">
                                    {loading ? 'Registering...' : 'Register Enterprise'}
                                </button>
                            </div>
                        </div>
                    )}

                    {step === STEP_DOCUMENTS && (
                        <div className="space-y-8 fade-in duration-500">
                            <div className="bg-emerald-50 border border-emerald-100 p-5 rounded-2xl flex items-start space-x-4">
                                <ShieldCheck className="text-emerald-700 mt-1" size={24} />
                                <div>
                                    <h5 className="text-[#002147] font-black text-xs uppercase tracking-tight">Ministry Audit Protocol</h5>
                                    <p className="text-[11px] text-slate-500 font-medium leading-relaxed">Identity verification is mandatory for ONDC network trust score. Upload official documents for AI-OCR processing.</p>
                                </div>
                            </div>

                            <div className="grid grid-cols-1 gap-4">
                                {[
                                    { id: 'aadhar', label: 'Aadhaar Card Verification', icon: CreditCard },
                                    { id: 'pan', label: 'PAN Card Verification', icon: FileText },
                                    { id: 'udyam', label: 'Udyam Registration Certificate', icon: ShieldCheck }
                                ].map((doc) => {
                                    const active = documents.find(d => d.type === doc.id);
                                    return (
                                        <div key={doc.id} className="bg-slate-50 border border-slate-200 rounded-2xl p-5 flex items-center justify-between group hover:border-orange-600/30 transition-all">
                                            <div className="flex items-center space-x-5">
                                                <div className="bg-white p-3 rounded-xl shadow-sm border border-slate-100 text-[#002147]">
                                                    <doc.icon size={20} />
                                                </div>
                                                <div>
                                                    <h6 className="text-[#002147] font-black text-sm uppercase tracking-tight">{doc.label}</h6>
                                                    <p className={`text-[10px] font-bold uppercase tracking-wider ${active?.status === 'completed' ? 'text-emerald-600' : 'text-slate-400'}`}>{active?.status || 'Awaiting Upload'}</p>
                                                </div>
                                            </div>
                                            {active?.status === 'completed' || active?.status === 'needs_review' ? (
                                                <div className="flex flex-col items-end gap-1">
                                                    <div className={`flex items-center space-x-2 ${active?.status === 'completed' ? 'bg-emerald-50 text-emerald-700 border-emerald-100' : 'bg-amber-50 text-amber-700 border-amber-100'} px-4 py-2 rounded-lg border`}>
                                                        {active?.status === 'completed' ? <CheckCircle2 size={14} /> : <Clock size={14} />}
                                                        <span className="text-[10px] font-black uppercase tracking-widest">
                                                            {active?.status === 'completed' ? 'Verified' : 'Needs Review'}
                                                        </span>
                                                    </div>
                                                    {active?.status === 'needs_review' && (
                                                        <span className="text-[9px] text-amber-600 font-bold">Verify manually - low confidence</span>
                                                    )}
                                                </div>
                                            ) : (
                                                <button
                                                    onClick={() => handleFileUpload(doc.id)}
                                                    disabled={active?.status === 'uploading' || active?.status === 'processing'}
                                                    className={`px-5 py-2.5 rounded-lg text-[10px] font-black uppercase tracking-widest transition-all ${(active?.status === 'uploading' || active?.status === 'processing') ? 'bg-slate-200 text-slate-400 cursor-not-allowed' : 'bg-[#002147] text-white hover:bg-orange-600 shadow-sm'}`}
                                                >
                                                    {(active?.status === 'uploading' || active?.status === 'processing') ? 'Analyzing...' : 'Upload'}
                                                </button>
                                            )}
                                        </div>
                                    );
                                })}
                            </div>

                            <div className="flex justify-between pt-6">
                                <button onClick={handlePrev} className="text-slate-400 hover:text-[#002147] font-black text-[10px] uppercase tracking-widest flex items-center space-x-2 transition-colors">
                                    <ArrowLeft size={16} />
                                    <span>Go Back</span>
                                </button>
                                <button onClick={handleNext} disabled={documents.length < 2} className="bg-[#002147] hover:bg-[#003366] disabled:opacity-30 text-white px-10 py-4 rounded-xl font-black text-[10px] uppercase tracking-[0.2em] shadow-lg active:scale-95 transition-all">
                                    <span>Continue to Catalogue</span>
                                </button>
                            </div>
                        </div>
                    )}

                    {step === STEP_PRODUCTS && (
                        <div className="space-y-8 fade-in duration-500">
                            <div className="flex items-center gap-5 p-6 bg-slate-50 border-2 border-dashed border-slate-200 rounded-2xl group hover:border-orange-600 transition-all cursor-pointer" onClick={() => alert('Bulk CSV Import scheduled for Phase 2 Deployment.')}>
                                <div className="bg-white p-4 rounded-xl text-orange-600 shadow-sm border border-slate-200 group-hover:scale-110 transition-transform">
                                    <Plus size={24} />
                                </div>
                                <div className="flex-1">
                                    <h6 className="text-[#002147] font-black text-sm uppercase tracking-tight">Bulk SKU Import</h6>
                                    <p className="text-[11px] text-slate-500 font-medium">Synchronize your entire warehouse with ONDC via CSV</p>
                                </div>
                            </div>

                            <div className="space-y-6">
                                <div className="space-y-1.5">
                                    <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest ml-1">Product Title</label>
                                    <input value={productData.product_name} onChange={(e) => { setProductData({ ...productData, product_name: e.target.value }); setProductErrors(prev => ({...prev, product_name: ''})); }} className={`w-full bg-slate-50 border ${productErrors.product_name ? 'border-red-500' : 'border-slate-200'} rounded-xl px-4 py-3.5 text-slate-900 font-bold focus:border-[#002147] outline-none transition-all placeholder:text-slate-300`} placeholder="e.g. Organic Cotton T-Shirt" />
                                    <FormError message={productErrors.product_name} />
                                </div>
                                <div className="space-y-1.5">
                                    <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest ml-1">Network Description</label>
                                    <textarea value={productData.description}
                                        onChange={(e) => { setProductData({ ...productData, description: e.target.value }); setProductErrors(prev => ({...prev, description: ''})); }}
                                        onBlur={handleCategorize}
                                        rows={4} className={`w-full bg-slate-50 border ${productErrors.description ? 'border-red-500' : 'border-slate-200'} rounded-xl px-4 py-3.5 text-slate-900 font-bold focus:border-[#002147] outline-none transition-all resize-none placeholder:text-slate-300`} placeholder="Required for AI categorization. Describe materials, quality, and usage..." />
                                    <FormError message={productErrors.description} />
                                </div>

                                <div className="grid grid-cols-2 gap-6">
                                    <div className="space-y-1.5">
                                        <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest ml-1">List Price (₹)</label>
                                        <input type="number" value={productData.price} onChange={(e) => { setProductData({ ...productData, price: e.target.value }); setProductErrors(prev => ({...prev, price: ''})); }} className={`w-full bg-slate-50 border ${productErrors.price ? 'border-red-500' : 'border-slate-200'} rounded-xl px-4 py-3.5 text-slate-900 font-bold focus:border-[#002147] outline-none transition-all placeholder:text-slate-300`} placeholder="0.00" />
                                        <FormError message={productErrors.price} />
                                    </div>
                                    <div className="space-y-1.5">
                                        <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest ml-1">Inventory Unit</label>
                                        <select value={productData.unit} onChange={(e) => setProductData({ ...productData, unit: e.target.value })} className="w-full bg-slate-50 border border-slate-200 rounded-xl px-4 py-3.5 font-bold text-slate-800 focus:border-[#002147] outline-none">
                                            <option value="pcs">Pieces (Pkt/No)</option>
                                            <option value="kg">Kilogram (kg)</option>
                                            <option value="mtr">Meter (m)</option>
                                        </select>
                                    </div>
                                </div>
                            </div>

                            <div className="flex justify-between pt-6">
                                <button onClick={handlePrev} className="text-slate-400 hover:text-[#002147] font-black text-[10px] uppercase tracking-widest flex items-center space-x-2 transition-colors">
                                    <ArrowLeft size={16} />
                                    <span>Go Back</span>
                                </button>
                                <button onClick={handleAddProduct} disabled={loading || !productData.product_name} className="bg-orange-600 hover:bg-orange-700 text-white px-10 py-4 rounded-xl font-black text-[10px] uppercase tracking-[0.2em] shadow-lg active:scale-95 transition-all">
                                    {loading ? 'Syncing...' : 'Sync with ONDC Registry'}
                                </button>
                            </div>
                        </div>
                    )}

                    {step === STEP_SUCCESS && (
                        <div className="text-center py-16 fade-in duration-700">
                            <div className="inline-flex items-center justify-center w-28 h-28 bg-emerald-50 text-emerald-600 rounded-[2.5rem] border-2 border-emerald-100 mb-10 transform rotate-12 shadow-sm">
                                <CheckCircle2 size={56} />
                            </div>
                            <h3 className="text-4xl font-black text-[#002147] mb-4 tracking-tighter uppercase">Registration Successful!</h3>
                            <p className="text-slate-500 mb-12 max-w-sm mx-auto text-sm font-medium leading-relaxed">
                                Your enterprise has been registered successfully. You can now explore matched partners and manage your catalogue.
                            </p>
                            <div className="space-y-4">
                                <Link to="/" className="w-full flex items-center justify-center space-x-3 bg-[#002147] text-white px-8 py-5 rounded-2xl font-black text-[10px] uppercase tracking-[0.2em] hover:bg-[#003366] transition-all transform hover:-translate-y-1 shadow-xl">
                                    <Wand2 size={18} />
                                    <span>Go to Dashboard</span>
                                </Link>
                                <button onClick={() => {
                                    setFormData({
                                        name: '',
                                        contact_person: '',
                                        email: '',
                                        phone: '',
                                        description: '',
                                        sector: '',
                                        address: '',
                                        city: '',
                                        state: '',
                                        pincode: '',
                                    });
                                    setPassword('');
                                    setConfirmPassword('');
                                    setStep(STEP_BASICS);
                                }} className="text-slate-400 hover:text-[#002147] text-[10px] font-black uppercase tracking-widest transition-colors">
                                    Add Another Enterprise Node
                                </button>
                            </div>
                        </div>
                    )}
                </div>
            </div>
        </div>
    );
}