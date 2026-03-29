import React, { useState, useEffect, useRef } from 'react';
import {
  ChevronLeft, Home, ShoppingCart, Dumbbell, User,
  Clock, Flame, Activity, RefreshCw,
  Check, Leaf, CheckCircle2, Sparkles, Loader2,
  Search, SlidersHorizontal, Bell, CheckSquare, Square, Plus, Camera, Send, X, CalendarDays, Users, Copy
} from 'lucide-react';

// --- Firebase Integration ---
import { initializeApp } from 'firebase/app';
import { getAuth, onAuthStateChanged, signInAnonymously, signInWithCustomToken } from 'firebase/auth';
import { getFirestore, doc, setDoc, getDoc, collection, onSnapshot } from 'firebase/firestore';

// Support both the Canvas/Firebase Studio global-variable pattern and standard
// Vite environment variables for local development.
const firebaseConfig =
  typeof __firebase_config !== 'undefined'
    ? JSON.parse(__firebase_config)
    : {
        apiKey: import.meta.env.VITE_FIREBASE_API_KEY,
        authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN,
        projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID,
        storageBucket: import.meta.env.VITE_FIREBASE_STORAGE_BUCKET,
        messagingSenderId: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID,
        appId: import.meta.env.VITE_FIREBASE_APP_ID,
      };

const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getFirestore(app);
const appId =
  typeof __app_id !== 'undefined' ? __app_id : 'default-app-id';

// --- Date Utils ---
const getWeekDates = () => {
  const dates = [];
  const today = new Date();
  for (let i = 0; i < 7; i++) {
    const d = new Date(today);
    d.setDate(today.getDate() + i);
    dates.push({
      day: d.toLocaleDateString('en-US', { weekday: 'short' }),
      date: d.getDate(),
      fullDate: d.toISOString().split('T')[0],
    });
  }
  return dates;
};

const getYesterdayString = (currentDateStr) => {
  const d = new Date(currentDateStr);
  d.setDate(d.getDate() - 1);
  return d.toISOString().split('T')[0];
};

// --- Gemini API Integration ---
// In the Canvas/Firebase Studio environment the key is injected at runtime.
// For local Vite development, set VITE_GEMINI_API_KEY in your .env file.
const apiKey =
  typeof __gemini_api_key !== 'undefined'
    ? __gemini_api_key
    : (import.meta.env.VITE_GEMINI_API_KEY ?? '');

const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const callGeminiAPI = async (prompt, schema, inlineData = null, retries = 5) => {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash-preview-09-2025:generateContent?key=${apiKey}`;

  const parts = [{ text: prompt }];
  if (inlineData) parts.push({ inlineData });

  const payload = {
    contents: [{ parts }],
    systemInstruction: {
      parts: [
        {
          text: `You are an expert Indian nutritionist, fitness coach, and AI vision scanner. 
        If given a photo of food or a barcode, estimate the macros precisely. 
        Always return valid JSON adhering EXACTLY to the requested schema.`,
        },
      ],
    },
    generationConfig: { responseMimeType: 'application/json', responseSchema: schema },
  };

  for (let i = 0; i < retries; i++) {
    try {
      const response = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      if (!response.ok) throw new Error(`HTTP error! status: ${response.status}`);
      const data = await response.json();
      return JSON.parse(data.candidates[0].content.parts[0].text);
    } catch (error) {
      if (i === retries - 1) throw error;
      await delay(Math.pow(2, i) * 1000);
    }
  }
};

// --- Schemas ---
const planSchema = {
  type: 'OBJECT',
  properties: {
    dailyTotalCalories: { type: 'INTEGER' },
    dailyTotalProtein: { type: 'INTEGER' },
    dailyTotalCarbs: { type: 'INTEGER' },
    dailyTotalFats: { type: 'INTEGER' },
    dailyTotalCost: { type: 'INTEGER' },
    meals: {
      type: 'ARRAY',
      items: {
        type: 'OBJECT',
        properties: {
          id: { type: 'STRING' },
          type: { type: 'STRING' },
          emoji: { type: 'STRING' },
          name: { type: 'STRING' },
          reminderTime: { type: 'STRING' },
          completed: { type: 'BOOLEAN' },
          calories: { type: 'INTEGER' },
          protein: { type: 'INTEGER' },
          cost: { type: 'INTEGER' },
          prepTime: { type: 'INTEGER' },
          ingredients: {
            type: 'ARRAY',
            items: {
              type: 'OBJECT',
              properties: {
                name: { type: 'STRING' },
                qty: { type: 'STRING' },
                price: { type: 'STRING' },
                icon: { type: 'STRING' },
              },
            },
          },
          steps: { type: 'ARRAY', items: { type: 'STRING' } },
        },
      },
    },
  },
  required: ['meals'],
};

const aiWorkoutSchema = {
  type: 'OBJECT',
  properties: {
    title: { type: 'STRING' },
    desc: { type: 'STRING' },
    duration: { type: 'INTEGER', description: 'Estimated duration in minutes' },
    exercises: {
      type: 'ARRAY',
      items: {
        type: 'OBJECT',
        properties: {
          name: { type: 'STRING' },
          target: { type: 'STRING', description: 'Primary muscle group' },
          reps: { type: 'STRING', description: 'E.g., 3 sets x 10 reps' },
          steps: {
            type: 'ARRAY',
            items: { type: 'STRING', description: 'Step-by-step instructions' },
          },
        },
      },
    },
  },
  required: ['title', 'exercises'],
};

const loggedMealSchema = {
  type: 'OBJECT',
  properties: {
    name: { type: 'STRING' },
    emoji: { type: 'STRING' },
    calories: { type: 'INTEGER' },
    protein: { type: 'INTEGER' },
    carbs: { type: 'INTEGER' },
    fats: { type: 'INTEGER' },
    cost: { type: 'INTEGER' },
  },
  required: ['name', 'calories', 'protein', 'carbs', 'fats'],
};

// --- Utils ---
const calculateTDEE = (profile) => {
  const weight = parseFloat(profile.weight) || 75;
  const height = parseFloat(profile.height) || 175;
  const age = parseFloat(profile.age) || 28;
  const isMale = profile.gender === 'male';
  let bmr = 10 * weight + 6.25 * height - 5 * age + (isMale ? 5 : -161);
  let target = bmr * 1.2;
  if (profile.goal === 'lose') target -= 500;
  if (profile.goal === 'gain') target += 500;
  return Math.round(target);
};

// --- Reusable Components ---
const Card = ({ children, className = '' }) => (
  <div className={`bg-zinc-900 rounded-3xl shadow-sm border border-zinc-800 p-4 ${className}`}>
    {children}
  </div>
);

const RingProgress = ({ value, max, label, color, size = 60, strokeWidth = 6 }) => {
  const radius = (size - strokeWidth) / 2;
  const circumference = radius * 2 * Math.PI;
  const safeValue = Math.min(Math.max(value, 0), max);
  const offset = circumference - (safeValue / max) * circumference;

  return (
    <div className="flex flex-col items-center justify-center relative">
      <svg width={size} height={size} className="transform -rotate-90">
        <circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          stroke="#27272a"
          strokeWidth={strokeWidth}
          fill="none"
        />
        <circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          stroke={color}
          strokeWidth={strokeWidth}
          fill="none"
          strokeDasharray={circumference}
          strokeDashoffset={offset}
          className="transition-all duration-1000 ease-out"
          strokeLinecap="round"
        />
      </svg>
      <div className="absolute flex flex-col items-center justify-center">
        <span className="text-xs font-bold text-white">{Math.round(value)}</span>
      </div>
      <span className="text-[10px] text-zinc-400 mt-1 font-medium text-center leading-tight">
        {label}
      </span>
    </div>
  );
};

const handleImageSelect = (file, callback) => {
  if (!file) return;
  const reader = new FileReader();
  reader.onload = (event) => {
    const img = new Image();
    img.onload = () => {
      const canvas = document.createElement('canvas');
      const MAX_WIDTH = 300;
      const scaleSize = MAX_WIDTH / img.width;
      canvas.width = MAX_WIDTH;
      canvas.height = img.height * scaleSize;
      const ctx = canvas.getContext('2d');
      ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
      callback(canvas.toDataURL('image/jpeg', 0.8));
    };
    img.src = event.target.result;
  };
  reader.readAsDataURL(file);
};

// --- Screens ---

const LoginScreen = ({ onLogin }) => {
  const [isLoggingIn, setIsLoggingIn] = useState(false);
  const [imgError, setImgError] = useState(false);

  const handleLogin = async () => {
    setIsLoggingIn(true);
    try {
      if (typeof __initial_auth_token !== 'undefined' && __initial_auth_token)
        await signInWithCustomToken(auth, __initial_auth_token);
      else await signInAnonymously(auth);
      onLogin();
    } catch (error) {
      setIsLoggingIn(false);
    }
  };

  return (
    <div className="flex flex-col min-h-screen bg-black animate-in fade-in duration-500 relative overflow-hidden">
      <div className="absolute top-0 left-0 w-full h-64 bg-lime-400/10 rounded-b-[4rem] -z-10"></div>
      <div className="absolute top-10 right-10 w-32 h-32 bg-lime-400/20 rounded-full blur-3xl opacity-50"></div>

      <div className="flex-1 flex flex-col items-center justify-center p-8 text-center mt-12">
        <div className="w-28 h-28 rounded-3xl shadow-xl shadow-lime-400/10 flex items-center justify-center mb-6 border border-zinc-800 bg-zinc-900 overflow-hidden">
          {!imgError ? (
            <img
              src="Eatwise Logo.jpeg"
              alt="Eatwise Logo"
              className="w-full h-full object-cover"
              onError={() => setImgError(true)}
            />
          ) : (
            <Leaf className="w-12 h-12 text-lime-400" />
          )}
        </div>
        <h1 className="text-4xl font-black text-white tracking-tight mb-3">Eatwise</h1>
        <p className="text-zinc-400 font-medium mb-12 max-w-[250px]">
          Your personal AI nutritionist &amp; fitness tracker.
        </p>
        <button
          onClick={handleLogin}
          disabled={isLoggingIn}
          className="w-full bg-lime-400 hover:bg-lime-500 text-black py-4 rounded-2xl font-black text-base shadow-sm transition-all active:scale-95 flex items-center justify-center gap-3"
        >
          {isLoggingIn ? (
            <Loader2 className="w-5 h-5 animate-spin text-black" />
          ) : (
            <>Get Started</>
          )}
        </button>
      </div>
    </div>
  );
};

const OnboardingScreen = ({ userProfile, setUserProfile, onSaveProfile }) => {
  const [isSaving, setIsSaving] = useState(false);
  const fileInputRef = useRef(null);

  const handleSave = async () => {
    if (!userProfile.name.trim()) return alert('Please enter your name!');
    setIsSaving(true);
    await onSaveProfile();
    setIsSaving(false);
  };

  return (
    <div className="flex flex-col min-h-screen bg-black pb-24 animate-in fade-in duration-500 text-white">
      <div className="pt-12 pb-6 px-6 bg-zinc-900 rounded-b-3xl shadow-sm z-10 border-b border-zinc-800">
        <h1 className="text-xl font-bold text-zinc-400 tracking-tight mb-1">Profile Setup</h1>
        <h2 className="text-2xl font-extrabold text-white leading-tight">
          Let's personalize <span className="text-lime-400">Eatwise</span>
          <br /> for your body.
        </h2>
      </div>

      <div className="px-6 py-6 space-y-8 flex-1">
        {/* Profile Picture Upload */}
        <div className="flex justify-center -mt-2">
          <div className="relative">
            <div className="w-24 h-24 rounded-full bg-zinc-900 border-2 border-lime-400 overflow-hidden flex items-center justify-center shadow-lg shadow-lime-400/10">
              {userProfile.photoURL ? (
                <img
                  src={userProfile.photoURL}
                  className="w-full h-full object-cover"
                  alt="Profile"
                />
              ) : (
                <User className="w-10 h-10 text-zinc-600" />
              )}
            </div>
            <button
              onClick={() => fileInputRef.current?.click()}
              className="absolute bottom-0 right-0 p-2.5 bg-lime-400 text-black rounded-full shadow-lg hover:scale-105 transition-transform"
            >
              <Camera className="w-4 h-4" />
            </button>
            <input
              type="file"
              ref={fileInputRef}
              accept="image/*"
              className="hidden"
              onChange={(e) =>
                handleImageSelect(e.target.files[0], (url) =>
                  setUserProfile((p) => ({ ...p, photoURL: url }))
                )
              }
            />
          </div>
        </div>

        <section className="space-y-4">
          <h3 className="text-sm font-bold text-zinc-400 uppercase tracking-wider">About You</h3>
          <div className="bg-zinc-900 rounded-2xl p-3 border border-zinc-800 shadow-sm focus-within:border-lime-400 transition-colors">
            <label className="text-xs text-zinc-500 font-medium px-1">First Name</label>
            <input
              type="text"
              placeholder="e.g. Rahul"
              value={userProfile.name}
              onChange={(e) => setUserProfile((p) => ({ ...p, name: e.target.value }))}
              className="w-full bg-transparent outline-none font-semibold text-white px-1 text-lg placeholder-zinc-600"
            />
          </div>
          <div className="grid grid-cols-3 gap-3">
            <div className="bg-zinc-900 rounded-2xl p-2 border border-zinc-800 focus-within:border-lime-400 transition-colors">
              <label className="text-xs text-zinc-500 font-medium px-1">Age</label>
              <input
                type="number"
                value={userProfile.age}
                onChange={(e) => setUserProfile((p) => ({ ...p, age: e.target.value }))}
                className="w-full bg-transparent outline-none font-semibold text-white px-1"
              />
            </div>
            <div className="bg-zinc-900 rounded-2xl p-2 border border-zinc-800 focus-within:border-lime-400 transition-colors">
              <label className="text-xs text-zinc-500 font-medium px-1">Height (cm)</label>
              <input
                type="number"
                value={userProfile.height}
                onChange={(e) => setUserProfile((p) => ({ ...p, height: e.target.value }))}
                className="w-full bg-transparent outline-none font-semibold text-white px-1"
              />
            </div>
            <div className="bg-zinc-900 rounded-2xl p-2 border border-zinc-800 focus-within:border-lime-400 transition-colors">
              <label className="text-xs text-zinc-500 font-medium px-1">Weight (kg)</label>
              <input
                type="number"
                value={userProfile.weight}
                onChange={(e) => setUserProfile((p) => ({ ...p, weight: e.target.value }))}
                className="w-full bg-transparent outline-none font-semibold text-white px-1"
              />
            </div>
          </div>
        </section>

        <section className="space-y-4">
          <h3 className="text-sm font-bold text-zinc-400 uppercase tracking-wider">
            Dietary Preferences
          </h3>
          <div className="flex bg-zinc-900 rounded-2xl p-1 border border-zinc-800 shadow-sm">
            {['Veg', 'Non-Veg'].map((diet) => (
              <button
                key={diet}
                onClick={() =>
                  setUserProfile((p) => ({ ...p, diet: diet.toLowerCase() }))
                }
                className={`flex-1 py-3 rounded-xl text-sm font-bold transition-all ${
                  userProfile.diet === diet.toLowerCase()
                    ? 'bg-lime-400/20 text-lime-400 border border-lime-400/30'
                    : 'text-zinc-500 hover:bg-zinc-800'
                }`}
              >
                {diet === 'Veg' ? '🥦 Veg' : '🍗 Non-Veg'}
              </button>
            ))}
          </div>
          {userProfile.diet === 'veg' && (
            <label className="flex justify-between items-center p-4 bg-zinc-900 rounded-2xl border border-zinc-800 cursor-pointer animate-in fade-in">
              <div className="flex items-center gap-3">
                <span className="text-xl">🥚</span>
                <span className="text-sm font-semibold text-white">Do you eat eggs?</span>
              </div>
              <div
                className={`w-12 h-6 rounded-full p-1 transition-colors ${
                  userProfile.eggs ? 'bg-lime-400' : 'bg-zinc-700'
                }`}
              >
                <div
                  className={`w-4 h-4 rounded-full bg-black shadow-sm transition-transform ${
                    userProfile.eggs ? 'translate-x-6' : ''
                  }`}
                ></div>
              </div>
              <input
                type="checkbox"
                className="hidden"
                checked={userProfile.eggs}
                onChange={() => setUserProfile((p) => ({ ...p, eggs: !p.eggs }))}
              />
            </label>
          )}
        </section>

        <section className="space-y-4">
          <h3 className="text-sm font-bold text-zinc-400 uppercase tracking-wider">Your Goal</h3>
          <div className="grid grid-cols-1 gap-3">
            {[
              { id: 'lose', label: 'Weight Loss', icon: '🔥', desc: 'Burn fat and get lean' },
              { id: 'maintain', label: 'General Health', icon: '🥑', desc: 'Maintain current weight' },
              { id: 'gain', label: 'Muscle Building', icon: '💪', desc: 'Bulk up and get stronger' },
            ].map((g) => (
              <button
                key={g.id}
                onClick={() => setUserProfile((p) => ({ ...p, goal: g.id }))}
                className={`flex items-center gap-4 p-4 rounded-3xl border transition-all text-left ${
                  userProfile.goal === g.id
                    ? 'bg-lime-400/10 border-lime-400'
                    : 'bg-zinc-900 border-zinc-800 text-zinc-400 hover:bg-zinc-800'
                }`}
              >
                <div
                  className={`w-12 h-12 rounded-full flex items-center justify-center text-2xl ${
                    userProfile.goal === g.id
                      ? 'bg-lime-400 text-black'
                      : 'bg-zinc-800 text-zinc-400'
                  }`}
                >
                  {g.icon}
                </div>
                <div>
                  <h4
                    className={`font-black text-lg ${
                      userProfile.goal === g.id ? 'text-lime-400' : 'text-white'
                    }`}
                  >
                    {g.label}
                  </h4>
                  <p className="text-xs text-zinc-500 font-medium">{g.desc}</p>
                </div>
              </button>
            ))}
          </div>
        </section>
      </div>

      <div className="fixed bottom-0 left-0 right-0 p-4 bg-black/80 backdrop-blur-md border-t border-zinc-800 max-w-md mx-auto z-20">
        <button
          onClick={handleSave}
          disabled={isSaving}
          className={`w-full py-4 rounded-2xl font-black text-lg shadow-lg transition-all flex items-center justify-center gap-2 ${
            isSaving
              ? 'bg-zinc-700 text-zinc-400 cursor-not-allowed'
              : 'bg-lime-400 hover:bg-lime-500 text-black shadow-lime-400/20 active:scale-95'
          }`}
        >
          {isSaving ? (
            <>
              <Loader2 className="w-5 h-5 animate-spin" /> Saving...
            </>
          ) : (
            <>
              <Check className="w-5 h-5" /> Calculate My Goal
            </>
          )}
        </button>
      </div>
    </div>
  );
};

const ProjectionScreen = ({ userProfile, onContinue }) => {
  const targetCals = calculateTDEE(userProfile);
  const targetWeight =
    userProfile.goal === 'lose'
      ? userProfile.weight - 5
      : userProfile.goal === 'gain'
      ? parseInt(userProfile.weight) + 5
      : userProfile.weight;

  const daysToGoal = userProfile.goal === 'maintain' ? 0 : 77;
  const goalDate = new Date();
  goalDate.setDate(goalDate.getDate() + daysToGoal);
  const dateString = goalDate.toLocaleDateString('en-US', {
    month: 'long',
    day: 'numeric',
    year: 'numeric',
  });

  return (
    <div className="flex flex-col min-h-screen bg-black text-white animate-in slide-in-from-right duration-500 p-8">
      <div className="flex-1 flex flex-col justify-center text-center space-y-8 mt-12">
        <div className="w-20 h-20 bg-lime-400/20 rounded-full flex items-center justify-center mx-auto mb-4 backdrop-blur-sm border border-lime-400/30">
          <Sparkles className="w-10 h-10 text-lime-400" />
        </div>
        <h1 className="text-3xl font-black tracking-tight leading-tight">
          Your Custom Plan is Ready!
        </h1>

        <div className="bg-zinc-900 rounded-3xl p-6 border border-zinc-800 text-left space-y-4 shadow-xl shadow-lime-400/5">
          <div>
            <span className="text-lime-400 text-sm font-bold uppercase tracking-wider">
              Daily Target
            </span>
            <div className="text-4xl font-black text-white">
              {targetCals}{' '}
              <span className="text-xl font-medium text-zinc-500">kcal</span>
            </div>
          </div>
          <div className="h-px w-full bg-zinc-800"></div>
          {userProfile.goal !== 'maintain' && (
            <div>
              <span className="text-lime-400 text-sm font-bold uppercase tracking-wider">
                Goal Prediction
              </span>
              <p className="text-lg font-medium leading-snug mt-1 text-zinc-300">
                Follow our suggestions to hit{' '}
                <span className="font-bold text-white">{targetWeight}kg</span> by:
              </p>
              <div className="text-2xl font-black mt-2 text-white flex items-center gap-2">
                <CalendarDays className="w-6 h-6 text-lime-400" /> {dateString}
              </div>
            </div>
          )}
        </div>
      </div>
      <button
        onClick={onContinue}
        className="w-full bg-lime-400 text-black py-4 rounded-2xl font-black text-lg shadow-xl shadow-lime-400/10 active:scale-95 transition-all mt-8 mb-12"
      >
        Start My Journey
      </button>
    </div>
  );
};

const DashboardScreen = ({
  userProfile,
  selectedDate,
  setSelectedDate,
  weekDates,
  dietPlan,
  isGeneratingPlan,
  onGeneratePlan,
  onMealClick,
  onToggleMeal,
  onOpenLog,
}) => {
  const [imgError, setImgError] = useState(false);
  const targetCals = calculateTDEE(userProfile);
  const targetProtein = Math.round((targetCals * 0.3) / 4);
  const targetCarbs = Math.round((targetCals * 0.45) / 4);

  const consumedCals =
    dietPlan?.meals?.filter((m) => m.completed).reduce((sum, m) => sum + (m.calories || 0), 0) || 0;
  const consumedPro =
    dietPlan?.meals?.filter((m) => m.completed).reduce((sum, m) => sum + (m.protein || 0), 0) || 0;
  const consumedCarbs =
    dietPlan?.meals?.filter((m) => m.completed).reduce((sum, m) => sum + (m.carbs || 0), 0) || 0;
  const burnedCals =
    dietPlan?.workouts?.reduce((sum, w) => sum + (w.burned || 0), 0) || 0;

  const isToday = selectedDate === weekDates[0].fullDate;
  const dObj = new Date(selectedDate);
  const headerDateStr = isToday
    ? 'Today'
    : dObj.toLocaleDateString('en-US', { weekday: 'long', month: 'short', day: 'numeric' });

  return (
    <div className="flex flex-col min-h-screen bg-black text-white pb-24 animate-in fade-in duration-500">
      <div className="pt-12 pb-4 px-6 bg-zinc-900 shadow-sm z-10 space-y-4 sticky top-0 border-b border-zinc-800 rounded-b-3xl">
        <div className="flex justify-between items-center">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-full border border-zinc-700 overflow-hidden bg-zinc-800 flex items-center justify-center">
              {userProfile.photoURL ? (
                <img
                  src={userProfile.photoURL}
                  className="w-full h-full object-cover"
                  alt="Profile"
                />
              ) : !imgError ? (
                <img
                  src="Eatwise Logo.jpeg"
                  alt="Logo"
                  className="w-full h-full object-cover"
                  onError={() => setImgError(true)}
                />
              ) : (
                <User className="w-5 h-5 text-zinc-500" />
              )}
            </div>
            <div>
              <h1 className="text-xl font-bold text-white tracking-tight leading-tight">
                Hello, {userProfile.name}!
              </h1>
              <p className="text-xs text-lime-400 font-medium">{headerDateStr}</p>
            </div>
          </div>
          <button
            onClick={() => onOpenLog()}
            className="w-10 h-10 bg-lime-400/10 rounded-full flex items-center justify-center text-lime-400 hover:bg-lime-400/20 transition-colors"
          >
            <Plus className="w-6 h-6" />
          </button>
        </div>

        {/* Dynamic Rings */}
        <div className="flex justify-between items-center pt-2">
          <RingProgress
            value={consumedCals}
            max={targetCals}
            label="Calories"
            color="#a3e635"
            size={75}
            strokeWidth={8}
          />
          <RingProgress value={consumedPro} max={targetProtein} label="Pro (g)" color="#38bdf8" size={60} />
          <RingProgress
            value={consumedCarbs}
            max={targetCarbs}
            label="Carbs (g)"
            color="#fbbf24"
            size={60}
          />
          <RingProgress value={burnedCals} max={500} label="Burned" color="#f43f5e" size={60} />
        </div>
      </div>

      <div className="px-6 py-6 space-y-6">
        {/* Date Scroll Strip */}
        <div className="flex gap-3 overflow-x-auto pb-2 scrollbar-hide -mx-6 px-6">
          {weekDates.map((d, i) => {
            const active = d.fullDate === selectedDate;
            return (
              <button
                key={i}
                onClick={() => setSelectedDate(d.fullDate)}
                className={`flex flex-col items-center justify-center min-w-[64px] py-3 rounded-2xl border transition-all ${
                  active
                    ? 'bg-lime-400 text-black border-lime-400 shadow-md shadow-lime-400/10 transform scale-105'
                    : 'bg-zinc-900 text-zinc-400 border-zinc-800 shadow-sm hover:bg-zinc-800'
                }`}
              >
                <span className="text-xs font-semibold mb-1">{d.day}</span>
                <span className={`text-xl font-black ${active ? 'text-black' : 'text-white'}`}>
                  {d.date}
                </span>
              </button>
            );
          })}
        </div>

        {!dietPlan && !isGeneratingPlan && (
          <div className="bg-zinc-900 rounded-3xl border border-dashed border-zinc-700 p-8 text-center space-y-4">
            <div className="w-16 h-16 bg-lime-400/10 rounded-full flex items-center justify-center mx-auto mb-2">
              <Sparkles className="w-8 h-8 text-lime-400" />
            </div>
            <h3 className="text-lg font-bold text-white">No Plan Generated</h3>
            <p className="text-sm text-zinc-400">
              Plan your day or just log meals manually using the + button.
            </p>
            <button
              onClick={onGeneratePlan}
              className="w-full py-4 bg-lime-400 hover:bg-lime-500 text-black rounded-2xl font-black shadow-md shadow-lime-400/20 active:scale-95 transition-all"
            >
              Generate AI Plan
            </button>
          </div>
        )}

        {isGeneratingPlan && (
          <div className="bg-zinc-900 rounded-3xl border border-zinc-800 p-8 text-center space-y-4">
            <Loader2 className="w-10 h-10 animate-spin text-lime-400 mx-auto" />
            <h3 className="text-lg font-bold text-white">Cooking up your plan...</h3>
          </div>
        )}

        {dietPlan && !isGeneratingPlan && (
          <div className="animate-in fade-in slide-in-from-bottom-4 duration-500 space-y-4">
            <div className="flex justify-between items-center mb-2">
              <h3 className="text-lg font-black text-white tracking-tight">Daily Meals</h3>
            </div>
            <div className="space-y-4">
              {dietPlan.meals?.map((meal) => (
                <div
                  key={meal.id}
                  className={`bg-zinc-900 rounded-3xl p-4 shadow-sm border flex items-center gap-4 transition-all group ${
                    meal.completed
                      ? 'border-lime-400/30 bg-lime-400/5'
                      : 'border-zinc-800 hover:border-lime-400/50 cursor-pointer active:scale-[0.98]'
                  }`}
                >
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      onToggleMeal(meal.id);
                    }}
                    className="p-1 text-zinc-600 hover:text-lime-400 transition-colors"
                  >
                    {meal.completed ? (
                      <CheckSquare className="w-7 h-7 text-lime-400" />
                    ) : (
                      <Square className="w-7 h-7" />
                    )}
                  </button>

                  <div
                    onClick={() => !meal.isLogged && onMealClick(meal)}
                    className="flex-1 flex items-center gap-4"
                  >
                    <div
                      className={`w-14 h-14 rounded-2xl flex items-center justify-center text-2xl transition-transform ${
                        meal.completed
                          ? 'bg-zinc-800 opacity-50'
                          : 'bg-zinc-800 group-hover:scale-105'
                      }`}
                    >
                      {meal.emoji || '🍲'}
                    </div>
                    <div className="flex-1">
                      <div className="flex items-center gap-2 mb-1">
                        <span className="text-[10px] font-black text-black uppercase tracking-wider bg-lime-400 px-2 py-0.5 rounded-sm">
                          {meal.type}
                        </span>
                        {meal.reminderTime && !meal.completed && (
                          <span className="flex items-center gap-1 text-[10px] font-bold text-zinc-400 bg-zinc-800 px-2 py-0.5 rounded-sm">
                            <Bell className="w-3 h-3" /> {meal.reminderTime}
                          </span>
                        )}
                      </div>
                      <h4
                        className={`font-bold leading-tight mb-1 line-clamp-1 ${
                          meal.completed ? 'text-zinc-500' : 'text-white'
                        }`}
                      >
                        {meal.name}
                      </h4>
                      <div className="flex gap-3 text-xs font-medium text-zinc-500">
                        <span className="flex items-center gap-1 text-lime-400">
                          <Flame className="w-3 h-3" /> {meal.calories} kcal
                        </span>
                        <span className="flex items-center gap-1 text-zinc-300">
                          <Activity className="w-3 h-3" /> {meal.protein}g Pro
                        </span>
                      </div>
                    </div>
                  </div>

                  {!meal.isLogged && (
                    <div
                      onClick={() => onMealClick(meal)}
                      className="w-8 h-8 rounded-full bg-zinc-800 flex items-center justify-center text-zinc-400 group-hover:bg-lime-400 group-hover:text-black transition-colors"
                    >
                      <ChevronLeft className="w-4 h-4 rotate-180" />
                    </div>
                  )}
                </div>
              ))}
            </div>

            {dietPlan.workouts && dietPlan.workouts.length > 0 && (
              <>
                <h3 className="text-lg font-black text-white tracking-tight mt-6 mb-2">
                  Logged Workouts
                </h3>
                <div className="space-y-3">
                  {dietPlan.workouts.map((w, i) => (
                    <div
                      key={i}
                      className="bg-zinc-900 rounded-3xl p-4 border border-zinc-800 flex items-center gap-4"
                    >
                      <div className="w-12 h-12 bg-zinc-800 rounded-xl flex items-center justify-center text-xl text-fuchsia-400">
                        <Dumbbell className="w-5 h-5" />
                      </div>
                      <div>
                        <h4 className="font-bold text-white">{w.name}</h4>
                        <p className="text-xs text-zinc-400">
                          {w.duration} mins •{' '}
                          <span className="text-fuchsia-400">{w.burned} kcal burned</span>
                        </p>
                      </div>
                    </div>
                  ))}
                </div>
              </>
            )}
          </div>
        )}
      </div>
    </div>
  );
};

const GroceriesScreen = () => {
  const categories = [
    { name: 'Dairy, Bread & Eggs', emoji: '🥛', color: 'bg-zinc-800/50', items: 'Milk, Paneer, Curd...' },
    { name: 'Fruits & Vegetables', emoji: '🥦', color: 'bg-zinc-800/50', items: 'Onion, Tomato, Spinach...' },
    { name: 'Atta, Rice & Dals', emoji: '🌾', color: 'bg-zinc-800/50', items: 'Basmati, Toor, Moong...' },
    { name: 'Meat, Fish & Eggs', emoji: '🥩', color: 'bg-zinc-800/50', items: 'Chicken, Mutton, Fish...' },
    { name: 'Masala & Dry Fruits', emoji: '🌶️', color: 'bg-zinc-800/50', items: 'Turmeric, Cashews...' },
    { name: 'Breakfast & Sauces', emoji: '🥞', color: 'bg-zinc-800/50', items: 'Oats, Ketchup, Jam...' },
    { name: 'Packaged Foods', emoji: '🥫', color: 'bg-zinc-800/50', items: 'Noodles, Pasta, Soups...' },
    { name: 'Munchies', emoji: '🥨', color: 'bg-zinc-800/50', items: 'Chips, Makhana, Biscuits...' },
  ];
  return (
    <div className="flex flex-col min-h-screen bg-black pb-24 animate-in fade-in duration-300 text-white">
      <div className="pt-12 pb-4 px-6 sticky top-0 bg-zinc-900/90 backdrop-blur-md z-20 shadow-sm border-b border-zinc-800">
        <h1 className="text-2xl font-black text-white tracking-tight mb-4">Groceries</h1>
        <div className="relative flex items-center">
          <Search className="w-5 h-5 absolute left-3 text-zinc-500" />
          <input
            type="text"
            placeholder="Search for 'Soya Chunks'"
            className="w-full bg-zinc-800 rounded-2xl py-4 pl-10 pr-10 outline-none text-sm font-medium text-white focus:border focus:border-lime-400 transition-all placeholder-zinc-500"
          />
          <SlidersHorizontal className="w-5 h-5 absolute right-3 text-zinc-500" />
        </div>
      </div>
      <div className="px-6 py-6">
        <h3 className="text-lg font-bold text-white tracking-tight mb-4">Shop by Category</h3>
        <div className="grid grid-cols-2 gap-4">
          {categories.map((cat, i) => (
            <div
              key={i}
              className={`${cat.color} rounded-3xl p-5 cursor-pointer active:scale-95 transition-all border border-zinc-800 hover:border-lime-400/50 hover:bg-zinc-800`}
            >
              <div className="text-4xl mb-3 drop-shadow-sm">{cat.emoji}</div>
              <h4 className="font-bold text-white text-sm leading-tight mb-1">{cat.name}</h4>
              <p className="text-[10px] text-zinc-400 font-medium leading-tight">{cat.items}</p>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
};

const RecipeScreen = ({ meal, onBack, onSwapMeal, onReplaceWithLog }) => {
  const [ingredientsPurchased, setIngredientsPurchased] = useState(false);
  const [isSwapping, setIsSwapping] = useState(false);
  const getImageUrl = (type) => {
    const images = {
      Breakfast:
        'https://images.unsplash.com/photo-1533089860892-a7c6f0a88666?ixlib=rb-4.0.3&auto=format&fit=crop&w=800&q=80',
      Lunch:
        'https://images.unsplash.com/photo-1512621776951-a57141f2eefd?ixlib=rb-4.0.3&auto=format&fit=crop&w=800&q=80',
      Snack:
        'https://images.unsplash.com/photo-1588195538326-c5b1e9f80a1b?ixlib=rb-4.0.3&auto=format&fit=crop&w=800&q=80',
      Dinner:
        'https://images.unsplash.com/photo-1546069901-ba9599a7e63c?ixlib=rb-4.0.3&auto=format&fit=crop&w=800&q=80',
    };
    return images[type] || images.Lunch;
  };
  if (!meal) return null;

  return (
    <div className="flex flex-col min-h-screen bg-black text-white pb-24 animate-in slide-in-from-right-4 duration-300 z-50 absolute top-0 w-full h-full overflow-y-auto">
      <div className="relative h-64 w-full bg-zinc-800 shrink-0">
        <img
          src={getImageUrl(meal.type)}
          alt={meal.name}
          className="w-full h-full object-cover opacity-80"
        />
        <div className="absolute inset-0 bg-gradient-to-t from-black to-transparent"></div>
        <button
          onClick={onBack}
          className="absolute top-12 left-4 w-10 h-10 bg-black/40 backdrop-blur-md rounded-full flex items-center justify-center text-white hover:bg-black/60 transition-all z-10"
        >
          <ChevronLeft className="w-6 h-6" />
        </button>
      </div>
      <div className="px-6 py-6 -mt-8 relative z-10 bg-zinc-900 rounded-t-3xl space-y-6 border-t border-zinc-800">
        <div>
          <h1 className="text-2xl font-black text-white tracking-tight mb-3">{meal.name}</h1>
          <div className="flex flex-wrap gap-2">
            <span className="flex items-center gap-1 bg-zinc-800 text-zinc-300 px-3 py-1.5 rounded-xl text-xs font-bold">
              <Clock className="w-3.5 h-3.5" /> {meal.prepTime} Mins
            </span>
            <span className="flex items-center gap-1 bg-lime-400/10 text-lime-400 border border-lime-400/20 px-3 py-1.5 rounded-xl text-xs font-bold">
              <Flame className="w-3.5 h-3.5" /> {meal.calories} kcal
            </span>
            <span className="flex items-center gap-1 bg-zinc-800 text-zinc-300 px-3 py-1.5 rounded-xl text-xs font-bold">
              <Activity className="w-3.5 h-3.5 text-sky-400" /> {meal.protein}g Pro
            </span>
          </div>
        </div>
        <button
          onClick={() => setIngredientsPurchased(true)}
          className={`w-full py-4 rounded-2xl font-black text-base shadow-lg transition-all active:scale-95 flex items-center justify-center gap-2 ${
            ingredientsPurchased
              ? 'bg-lime-400/20 text-lime-400 border border-lime-400'
              : 'bg-lime-400 text-black hover:bg-lime-500'
          }`}
        >
          {ingredientsPurchased ? (
            <>
              <CheckCircle2 className="w-5 h-5" /> Added to Cart
            </>
          ) : (
            <>🛒 Order on Zepto - ₹{meal.cost + 50}</>
          )}
        </button>
        <section>
          <h3 className="text-lg font-bold text-white mb-3 tracking-tight">What you need</h3>
          <Card className="p-0 overflow-hidden bg-zinc-900 border-zinc-800">
            <ul className="divide-y divide-zinc-800">
              {meal.ingredients?.map((ing, i) => (
                <li key={i} className="flex items-center gap-3 p-4 hover:bg-zinc-800/50 transition-colors">
                  <div className="w-8 h-8 bg-zinc-800 rounded-xl flex items-center justify-center text-sm">
                    {ing.icon}
                  </div>
                  <div className="flex-1">
                    <span className="text-sm font-bold text-white block">{ing.name}</span>
                    <span className="text-xs text-zinc-500 font-medium">{ing.qty}</span>
                  </div>
                  <span className="text-xs font-bold text-lime-400 bg-lime-400/10 px-2.5 py-1 rounded-md">
                    {ing.price}
                  </span>
                </li>
              ))}
            </ul>
          </Card>
        </section>
        <section>
          <h3 className="text-lg font-bold text-white mb-3 tracking-tight">How to make it</h3>
          <div className="space-y-4">
            {meal.steps?.map((step, i) => (
              <div key={i} className="flex gap-4">
                <div className="flex-shrink-0 w-7 h-7 rounded-full bg-zinc-800 text-lime-400 flex items-center justify-center text-xs font-black mt-0.5">
                  {i + 1}
                </div>
                <p className="text-sm text-zinc-400 leading-relaxed font-medium">{step}</p>
              </div>
            ))}
          </div>
        </section>

        {/* Meal Replacement Options */}
        <div className="mt-8 pt-6 border-t border-zinc-800 pb-12">
          <p className="text-sm text-zinc-500 font-medium mb-3 text-center">Diet Variety Options</p>
          <button
            onClick={async () => {
              setIsSwapping(true);
              await onSwapMeal(meal);
              setIsSwapping(false);
              setIngredientsPurchased(false);
            }}
            disabled={isSwapping}
            className={`w-full py-4 border-2 border-zinc-700 text-zinc-300 rounded-2xl font-bold text-sm transition-colors flex items-center justify-center gap-2 ${
              isSwapping
                ? 'bg-zinc-800 cursor-not-allowed'
                : 'bg-black hover:bg-zinc-800 hover:border-zinc-600'
            }`}
          >
            {isSwapping ? (
              <>
                <Loader2 className="w-4 h-4 animate-spin" /> Cooking alternative...
              </>
            ) : (
              <>
                <Sparkles className="w-4 h-4" /> Swap Meal (Keeps ₹{meal.cost} Budget)
              </>
            )}
          </button>

          <div className="flex items-center justify-center gap-4 py-4">
            <div className="h-px bg-zinc-800 flex-1"></div>
            <span className="text-xs font-bold text-zinc-600 uppercase tracking-wider">OR</span>
            <div className="h-px bg-zinc-800 flex-1"></div>
          </div>

          <button
            onClick={() => onReplaceWithLog(meal.id)}
            className="w-full py-4 border-2 border-dashed border-zinc-700 text-lime-400 rounded-2xl font-bold text-sm transition-colors flex items-center justify-center gap-2 hover:bg-lime-400/5"
          >
            <Camera className="w-4 h-4" /> Ate something else? Log it
          </button>
        </div>
      </div>
    </div>
  );
};

const WorkoutsScreen = ({
  userProfile,
  onLogWorkout,
  aiWorkout,
  onGenerateWorkout,
  isGeneratingWorkout,
}) => {
  const [environment, setEnvironment] = useState('gym');
  const [targetMuscles, setTargetMuscles] = useState('');
  const [isLogging, setIsLogging] = useState(false);
  const [workoutDuration, setWorkoutDuration] = useState('');

  const handleSaveWorkout = () => {
    if (!aiWorkout || !workoutDuration) return;
    const dur = parseInt(workoutDuration);
    const burned = Math.round(parseFloat(userProfile.weight || 75) * dur * 0.1);
    onLogWorkout({ name: aiWorkout.title, duration: dur, burned });
    setIsLogging(false);
    setWorkoutDuration('');
  };

  return (
    <div className="flex flex-col min-h-screen bg-black pb-24 animate-in fade-in duration-300 text-white">
      <div className="pt-12 pb-4 px-6 sticky top-0 bg-zinc-900/90 backdrop-blur-md z-20 shadow-sm border-b border-zinc-800 flex justify-between items-center">
        <h1 className="text-2xl font-black text-white tracking-tight">AI Workout Builder</h1>
      </div>

      <div className="px-6 py-6 space-y-6">
        <section className="bg-zinc-900 rounded-3xl p-6 border border-zinc-800 space-y-5">
          <div>
            <h3 className="font-bold text-white mb-3">Where are you training?</h3>
            <div className="flex bg-black rounded-2xl p-1 border border-zinc-800 shadow-sm">
              <button
                onClick={() => setEnvironment('gym')}
                className={`flex-1 py-3 rounded-xl text-sm font-bold transition-all flex items-center justify-center gap-2 ${
                  environment === 'gym'
                    ? 'bg-lime-400/20 text-lime-400 border border-lime-400/30'
                    : 'text-zinc-500 hover:bg-zinc-800'
                }`}
              >
                <Dumbbell className="w-4 h-4" /> Gym
              </button>
              <button
                onClick={() => setEnvironment('home')}
                className={`flex-1 py-3 rounded-xl text-sm font-bold transition-all flex items-center justify-center gap-2 ${
                  environment === 'home'
                    ? 'bg-lime-400/20 text-lime-400 border border-lime-400/30'
                    : 'text-zinc-500 hover:bg-zinc-800'
                }`}
              >
                <Home className="w-4 h-4" /> Home
              </button>
            </div>
          </div>

          <div>
            <h3 className="font-bold text-white mb-3">Target Muscles Today</h3>
            <input
              type="text"
              placeholder="e.g., Chest and Triceps, Legs..."
              value={targetMuscles}
              onChange={(e) => setTargetMuscles(e.target.value)}
              className="w-full bg-black border border-zinc-800 rounded-2xl py-4 px-4 outline-none focus:border-lime-400 text-white placeholder-zinc-600 transition-colors"
            />
          </div>

          <button
            onClick={() => targetMuscles && onGenerateWorkout(environment, targetMuscles)}
            disabled={isGeneratingWorkout || !targetMuscles.trim()}
            className={`w-full py-4 rounded-2xl font-black shadow-md transition-all active:scale-95 flex items-center justify-center gap-2 ${
              isGeneratingWorkout || !targetMuscles.trim()
                ? 'bg-zinc-800 text-zinc-500 cursor-not-allowed'
                : 'bg-lime-400 hover:bg-lime-500 text-black shadow-lime-400/20'
            }`}
          >
            {isGeneratingWorkout ? (
              <>
                <Loader2 className="w-5 h-5 animate-spin" /> Generating...
              </>
            ) : (
              <>
                <Sparkles className="w-5 h-5" /> Generate Routine
              </>
            )}
          </button>
        </section>

        {aiWorkout && !isGeneratingWorkout && (
          <section className="space-y-6 animate-in slide-in-from-bottom-4 fade-in duration-500">
            <div className="bg-zinc-900 rounded-3xl p-6 border border-zinc-800">
              <h2 className="text-2xl font-black text-lime-400 mb-1">{aiWorkout.title}</h2>
              <p className="text-sm text-zinc-400 mb-4">
                {aiWorkout.desc} • ~{aiWorkout.duration} mins
              </p>

              <div className="space-y-4">
                {aiWorkout.exercises?.map((ex, i) => (
                  <div key={i} className="bg-black rounded-2xl p-4 border border-zinc-800">
                    <div className="flex justify-between items-start mb-3">
                      <div>
                        <h3 className="font-bold text-white">{ex.name}</h3>
                        <span className="text-[10px] text-zinc-500 uppercase font-bold tracking-wider">
                          {ex.target}
                        </span>
                      </div>
                      <span className="text-xs font-black text-black bg-lime-400 px-2 py-1 rounded-md shrink-0 ml-2">
                        {ex.reps}
                      </span>
                    </div>
                    <div className="space-y-2">
                      {ex.steps?.map((step, stepIdx) => (
                        <div key={stepIdx} className="flex gap-3">
                          <div className="w-5 h-5 rounded-full bg-zinc-900 text-lime-400 flex items-center justify-center text-[10px] font-black shrink-0 mt-0.5 border border-zinc-800">
                            {stepIdx + 1}
                          </div>
                          <p className="text-xs text-zinc-400 leading-snug">{step}</p>
                        </div>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
              <button
                onClick={() => setIsLogging(true)}
                className="w-full mt-6 py-4 bg-lime-400 text-black rounded-2xl font-black text-base active:scale-95 transition-transform flex items-center justify-center gap-2"
              >
                <CheckCircle2 className="w-5 h-5" /> Complete &amp; Log Workout
              </button>
            </div>
          </section>
        )}
      </div>

      {isLogging && (
        <div className="fixed inset-0 z-50 flex items-end justify-center sm:items-center bg-black/80 backdrop-blur-md animate-in fade-in">
          <div className="bg-zinc-900 w-full max-w-md sm:rounded-3xl rounded-t-3xl p-6 shadow-2xl border border-zinc-800 animate-in slide-in-from-bottom-10">
            <div className="flex justify-between items-center mb-6">
              <h2 className="text-xl font-black text-white flex items-center gap-2">
                Log Workout
              </h2>
              <button
                onClick={() => setIsLogging(false)}
                className="p-2 bg-zinc-800 rounded-full text-zinc-400 hover:text-white"
              >
                <X className="w-5 h-5" />
              </button>
            </div>
            <div className="space-y-4">
              <div>
                <label className="text-xs text-zinc-400 font-bold ml-1 mb-1 block">
                  Workout Completed
                </label>
                <input
                  type="text"
                  value={aiWorkout.title}
                  disabled
                  className="w-full bg-black border border-zinc-800 rounded-2xl p-4 text-zinc-500 outline-none"
                />
              </div>
              <div>
                <label className="text-xs text-lime-400 font-bold ml-1 mb-1 block">
                  Actual Duration (minutes)
                </label>
                <input
                  type="number"
                  placeholder="45"
                  value={workoutDuration}
                  onChange={(e) => setWorkoutDuration(e.target.value)}
                  className="w-full bg-black border border-zinc-800 rounded-2xl p-4 text-white focus:border-lime-400 outline-none"
                />
              </div>
              <button
                onClick={handleSaveWorkout}
                className="w-full py-4 bg-lime-400 text-black font-black rounded-2xl mt-4 active:scale-95 transition-transform"
              >
                Save to Daily Progress
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

const BuddiesScreen = ({ userProfile, setUserProfile, onSaveProfile, userId, buddiesData, myStats }) => {
  const [buddyCodeInput, setBuddyCodeInput] = useState('');

  const copyToClipboard = () => {
    navigator.clipboard.writeText(userId);
    alert('Buddy code copied!');
  };

  const handleBuddySave = () => {
    if (!buddyCodeInput.trim()) return;
    const currentBuddies = userProfile.buddyIds || [];
    if (!currentBuddies.includes(buddyCodeInput)) {
      setUserProfile((p) => ({ ...p, buddyIds: [...currentBuddies, buddyCodeInput] }));
      onSaveProfile(false);
      alert('Buddy Added Successfully!');
    } else {
      alert('Buddy already linked.');
    }
    setBuddyCodeInput('');
  };

  return (
    <div className="flex flex-col min-h-screen bg-black pb-24 animate-in fade-in duration-300 text-white">
      <div className="pt-12 pb-4 px-6 bg-zinc-900 shadow-sm border-b border-zinc-800 sticky top-0 z-10">
        <h1 className="text-2xl font-black text-white tracking-tight">Fitness Buddies</h1>
      </div>

      <div className="p-6 space-y-6">
        {/* Link new buddy */}
        <section className="bg-zinc-900 rounded-3xl p-6 shadow-sm border border-zinc-800 space-y-4">
          <div className="flex items-center gap-2 mb-2">
            <Users className="w-5 h-5 text-lime-400" />
            <h3 className="font-bold text-white text-lg">Add a Buddy</h3>
          </div>
          <p className="text-xs text-zinc-400 leading-relaxed">
            Share progress and compete with friends daily to hit your goals together!
          </p>

          <div className="bg-black border border-zinc-800 p-3 rounded-2xl flex items-center justify-between">
            <div>
              <p className="text-[10px] text-zinc-500 font-bold uppercase tracking-wider mb-0.5">
                Your Unique Code
              </p>
              <p className="text-sm font-mono text-zinc-300">{userId?.substring(0, 12)}...</p>
            </div>
            <button
              onClick={copyToClipboard}
              className="p-2 bg-zinc-800 rounded-xl hover:text-lime-400 transition-colors flex items-center gap-2 text-xs font-bold px-3"
            >
              <Copy className="w-4 h-4" /> Copy
            </button>
          </div>

          <div className="flex gap-2 pt-2">
            <input
              type="text"
              placeholder="Paste friend's code here..."
              value={buddyCodeInput}
              onChange={(e) => setBuddyCodeInput(e.target.value)}
              className="flex-1 bg-black border border-zinc-800 rounded-xl px-4 text-sm outline-none focus:border-lime-400 placeholder-zinc-600"
            />
            <button
              onClick={handleBuddySave}
              className="bg-lime-400 text-black px-5 py-3 rounded-xl font-black text-sm active:scale-95 transition-transform"
            >
              Link
            </button>
          </div>
        </section>

        {/* List of Buddies Progress */}
        <section className="space-y-4">
          <h3 className="text-lg font-bold text-white tracking-tight">
            Daily Progress Leaderboard
          </h3>

          {/* My own progress */}
          <div className="bg-gradient-to-r from-lime-400/10 to-zinc-900 rounded-3xl p-5 border border-lime-400/30 flex items-center gap-4 relative overflow-hidden">
            <div className="w-14 h-14 rounded-full bg-black border-2 border-lime-400 flex items-center justify-center overflow-hidden shrink-0">
              {userProfile.photoURL ? (
                <img
                  src={userProfile.photoURL}
                  className="w-full h-full object-cover"
                  alt="Me"
                />
              ) : (
                <User className="w-6 h-6 text-zinc-500" />
              )}
            </div>
            <div className="flex-1 z-10">
              <h4 className="font-black text-white text-base mb-2">
                You{' '}
                <span className="text-xs font-bold bg-lime-400 text-black px-2 py-0.5 rounded-md ml-2">
                  Me
                </span>
              </h4>
              <div className="space-y-2">
                <div>
                  <div className="flex justify-between text-[10px] font-bold mb-1">
                    <span className="text-zinc-400 uppercase">Protein</span>
                    <span className="text-sky-400">{myStats.consumedPro}g</span>
                  </div>
                  <div className="flex h-1.5 bg-black rounded-full overflow-hidden">
                    <div
                      className="bg-sky-400 h-full"
                      style={{
                        width: `${Math.min((myStats.consumedPro / 150) * 100, 100)}%`,
                      }}
                    ></div>
                  </div>
                </div>
                <div>
                  <div className="flex justify-between text-[10px] font-bold mb-1">
                    <span className="text-zinc-400 uppercase">Workout</span>
                    <span className="text-fuchsia-400">{myStats.workoutMins}m</span>
                  </div>
                  <div className="flex h-1.5 bg-black rounded-full overflow-hidden">
                    <div
                      className="bg-fuchsia-400 h-full"
                      style={{
                        width: `${Math.min((myStats.workoutMins / 60) * 100, 100)}%`,
                      }}
                    ></div>
                  </div>
                </div>
              </div>
            </div>
          </div>

          {/* Linked Buddies */}
          {userProfile.buddyIds && userProfile.buddyIds.length > 0 ? (
            userProfile.buddyIds.map((id, i) => {
              const bData = buddiesData[id];
              if (!bData)
                return (
                  <div
                    key={i}
                    className="bg-zinc-900 rounded-3xl p-5 border border-zinc-800 flex items-center gap-4 opacity-50"
                  >
                    <Loader2 className="w-6 h-6 animate-spin text-zinc-500 shrink-0" />
                    <div>
                      <h4 className="font-bold text-zinc-400">Loading Buddy Data...</h4>
                    </div>
                  </div>
                );
              return (
                <div
                  key={i}
                  className="bg-zinc-900 rounded-3xl p-5 border border-zinc-800 flex items-center gap-4"
                >
                  <div className="w-14 h-14 rounded-full bg-black border border-zinc-700 flex items-center justify-center overflow-hidden shrink-0">
                    {bData.photoURL ? (
                      <img
                        src={bData.photoURL}
                        className="w-full h-full object-cover"
                        alt="Buddy"
                      />
                    ) : (
                      <User className="w-6 h-6 text-zinc-500" />
                    )}
                  </div>
                  <div className="flex-1">
                    <h4 className="font-bold text-white text-base mb-2">{bData.name}</h4>
                    <div className="space-y-2">
                      <div>
                        <div className="flex justify-between text-[10px] font-bold mb-1">
                          <span className="text-zinc-400 uppercase">Protein</span>
                          <span className="text-sky-400">{bData.consumedPro}g</span>
                        </div>
                        <div className="flex h-1.5 bg-black rounded-full overflow-hidden">
                          <div
                            className="bg-sky-400 h-full"
                            style={{
                              width: `${Math.min((bData.consumedPro / 150) * 100, 100)}%`,
                            }}
                          ></div>
                        </div>
                      </div>
                      <div>
                        <div className="flex justify-between text-[10px] font-bold mb-1">
                          <span className="text-zinc-400 uppercase">Workout</span>
                          <span className="text-fuchsia-400">{bData.workoutMins}m</span>
                        </div>
                        <div className="flex h-1.5 bg-black rounded-full overflow-hidden">
                          <div
                            className="bg-fuchsia-400 h-full"
                            style={{
                              width: `${Math.min((bData.workoutMins / 60) * 100, 100)}%`,
                            }}
                          ></div>
                        </div>
                      </div>
                    </div>
                  </div>
                </div>
              );
            })
          ) : (
            <div className="text-center py-8 text-zinc-500 text-sm">
              You haven't linked any buddies yet. Add their code above!
            </div>
          )}
        </section>
      </div>
    </div>
  );
};

const ProfileScreen = ({ userProfile, setUserProfile, onSaveProfile }) => {
  return (
    <div className="flex flex-col min-h-screen bg-black pb-24 animate-in fade-in duration-300 text-white">
      <div className="pt-12 pb-4 px-6 bg-zinc-900 shadow-sm border-b border-zinc-800 sticky top-0 z-10">
        <h1 className="text-2xl font-black text-white tracking-tight">Profile Settings</h1>
      </div>

      <div className="p-6 space-y-6">
        <div className="bg-zinc-900 rounded-3xl p-6 flex flex-col items-center text-center gap-4 shadow-sm border border-zinc-800 relative">
          <div className="relative">
            <div className="w-24 h-24 rounded-full bg-zinc-800 border-2 border-lime-400 overflow-hidden flex items-center justify-center">
              {userProfile.photoURL ? (
                <img
                  src={userProfile.photoURL}
                  className="w-full h-full object-cover"
                  alt="Profile"
                />
              ) : (
                <User className="w-10 h-10 text-zinc-500" />
              )}
            </div>
          </div>
          <div>
            <h2 className="text-2xl font-black text-white">{userProfile.name}</h2>
            <p className="text-sm text-zinc-400 capitalize">
              {userProfile.goal} Weight • {userProfile.diet}
            </p>
          </div>
        </div>

        <section className="bg-zinc-900 rounded-3xl p-6 shadow-sm border border-zinc-800 space-y-4">
          <div className="flex justify-between items-end">
            <div>
              <h3 className="font-bold text-white">Daily Food Budget</h3>
              <p className="text-xs text-zinc-500 mt-1">AI plans stay under this limit.</p>
            </div>
            <span className="text-2xl font-black text-lime-400 tracking-tight">
              ₹{userProfile.budget}
            </span>
          </div>
          <div className="pt-4 pb-2">
            <input
              type="range"
              min="100"
              max="1000"
              step="50"
              value={userProfile.budget}
              onChange={(e) => setUserProfile((p) => ({ ...p, budget: e.target.value }))}
              onMouseUp={() => onSaveProfile(false)}
              onTouchEnd={() => onSaveProfile(false)}
              className="w-full h-2 bg-zinc-800 rounded-lg appearance-none cursor-pointer accent-lime-400"
            />
            <div className="flex justify-between text-xs font-medium text-zinc-500 mt-3">
              <span>₹100</span>
              <span>₹1000</span>
            </div>
          </div>
        </section>
      </div>
    </div>
  );
};

const LogFoodModal = ({ onClose, onLogMeal, replaceMealId }) => {
  const [inputText, setInputText] = useState('');
  const [isProcessing, setIsProcessing] = useState(false);
  const fileInputRef = useRef(null);

  const processInput = async (text, fileBase64 = null, mimeType = null) => {
    setIsProcessing(true);
    try {
      const prompt = text
        ? `User ate: "${text}". Estimate calories, protein, carbs, fats, and roughly cost in INR.`
        : `Analyze this image of food or a barcode/nutrition label. Estimate calories, protein, carbs, fats, and roughly cost in INR. Identify the main item.`;
      const inlineData =
        fileBase64 && mimeType ? { mimeType: mimeType, data: fileBase64 } : null;

      const result = await callGeminiAPI(prompt, loggedMealSchema, inlineData);

      const loggedMeal = {
        id: replaceMealId ? replaceMealId : `log-${Date.now()}`,
        type: 'Logged',
        isLogged: true,
        completed: true,
        name: result.name || text || 'Logged Food',
        emoji: result.emoji || '🍽️',
        calories: result.calories || 0,
        protein: result.protein || 0,
        carbs: result.carbs || 0,
        fats: result.fats || 0,
        cost: result.cost || 0,
      };

      onLogMeal(loggedMeal, replaceMealId);
      onClose();
    } catch (e) {
      alert('Failed to analyze food. Please try again.');
    } finally {
      setIsProcessing(false);
    }
  };

  const handleImageUpload = (e) => {
    const file = e.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onloadend = () => {
      const base64String = reader.result.split(',')[1];
      processInput(null, base64String, file.type);
    };
    reader.readAsDataURL(file);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center sm:items-center bg-black/80 backdrop-blur-md animate-in fade-in">
      <div className="bg-zinc-900 w-full max-w-md sm:rounded-3xl rounded-t-3xl p-6 shadow-2xl border border-zinc-800 animate-in slide-in-from-bottom-10">
        <div className="flex justify-between items-center mb-2">
          <h2 className="text-xl font-black text-white flex items-center gap-2">
            <Sparkles className="w-5 h-5 text-lime-400" />{' '}
            {replaceMealId ? 'Ate something else?' : 'AI Food Logger'}
          </h2>
          <button
            onClick={onClose}
            className="p-2 bg-zinc-800 rounded-full text-zinc-400 hover:text-white"
          >
            <X className="w-5 h-5" />
          </button>
        </div>
        <p className="text-xs text-zinc-400 mb-4 leading-relaxed">
          Add what you ate here to keep your daily nutrient progress accurate.
        </p>

        {isProcessing ? (
          <div className="py-12 text-center space-y-4">
            <Loader2 className="w-12 h-12 text-lime-400 animate-spin mx-auto" />
            <p className="text-zinc-400 font-medium">Scanning food &amp; calculating macros...</p>
          </div>
        ) : (
          <div className="space-y-4">
            <div className="relative">
              <input
                type="text"
                placeholder="e.g., '2 samosas and 1 chai'"
                value={inputText}
                onChange={(e) => setInputText(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && inputText && processInput(inputText)}
                className="w-full bg-black border border-zinc-800 rounded-2xl py-4 pl-4 pr-12 outline-none focus:border-lime-400 text-white placeholder-zinc-600 transition-colors"
              />
              <button
                onClick={() => inputText && processInput(inputText)}
                className="absolute right-2 top-2 bottom-2 bg-lime-400 text-black rounded-xl px-3 flex items-center justify-center hover:bg-lime-500 transition-colors"
              >
                <Send className="w-4 h-4" />
              </button>
            </div>

            <div className="flex items-center justify-center gap-4 py-2">
              <div className="h-px bg-zinc-800 flex-1"></div>
              <span className="text-xs font-bold text-zinc-600 uppercase tracking-wider">OR</span>
              <div className="h-px bg-zinc-800 flex-1"></div>
            </div>

            <button
              onClick={() => fileInputRef.current?.click()}
              className="w-full border-2 border-dashed border-zinc-700 hover:border-lime-400 hover:bg-lime-400/5 text-white rounded-3xl py-6 flex flex-col items-center justify-center gap-3 transition-all group"
            >
              <div className="w-14 h-14 bg-zinc-800 group-hover:bg-lime-400 rounded-full flex items-center justify-center transition-colors">
                <Camera className="w-6 h-6 text-zinc-400 group-hover:text-black" />
              </div>
              <span className="font-bold">Scan Barcode or Meal</span>
              <span className="text-xs text-zinc-500">Take a photo to auto-detect macros</span>
            </button>
            <input
              type="file"
              ref={fileInputRef}
              accept="image/*"
              capture="environment"
              className="hidden"
              onChange={handleImageUpload}
            />
          </div>
        )}
      </div>
    </div>
  );
};

// --- Main App Container ---
export default function App() {
  const [authChecked, setAuthChecked] = useState(false);
  const [user, setUser] = useState(null);

  const [isGeneratingPlan, setIsGeneratingPlan] = useState(false);
  const [isGeneratingWorkouts, setIsGeneratingWorkouts] = useState(false);

  const [currentTab, setCurrentTab] = useState('dashboard');
  const [viewingRecipe, setViewingRecipe] = useState(null);
  const [needsOnboarding, setNeedsOnboarding] = useState(false);
  const [showProjection, setShowProjection] = useState(false);
  const [loggingContext, setLoggingContext] = useState({ isOpen: false, replaceId: null });

  const [userProfile, setUserProfile] = useState({
    name: '',
    age: 28,
    height: 175,
    weight: 75,
    gender: 'male',
    goal: 'lose',
    budget: 250,
    diet: 'veg',
    eggs: false,
    buddyIds: [],
    photoURL: '',
    health: { diabetes: false, bp: false, pcos: false, none: true },
  });

  const weekDates = getWeekDates();
  const [selectedDate, setSelectedDate] = useState(weekDates[0].fullDate);
  const [weeklyPlans, setWeeklyPlans] = useState({});
  const [buddiesData, setBuddiesData] = useState({});

  useEffect(() => {
    const initAuth = async () => {
      if (typeof __initial_auth_token !== 'undefined' && __initial_auth_token)
        await signInWithCustomToken(auth, __initial_auth_token);
      else await signInAnonymously(auth);
    };
    initAuth();

    const unsubscribe = onAuthStateChanged(auth, async (currentUser) => {
      setUser(currentUser);
      if (currentUser) {
        try {
          const profileRef = doc(
            db,
            'artifacts',
            appId,
            'users',
            currentUser.uid,
            'profile',
            'data'
          );
          const profileSnap = await getDoc(profileRef);
          if (profileSnap.exists()) {
            const data = profileSnap.data();
            // Backward compatibility for single buddyId field
            if (data.buddyId && (!data.buddyIds || !data.buddyIds.includes(data.buddyId))) {
              data.buddyIds = data.buddyIds || [];
              data.buddyIds.push(data.buddyId);
            }
            setUserProfile(data);
            setNeedsOnboarding(false);
          } else {
            setNeedsOnboarding(true);
          }
        } catch (e) {
          console.error(e);
        }
      }
      setAuthChecked(true);
    });
    return () => unsubscribe();
  }, []);

  useEffect(() => {
    if (!user || needsOnboarding) return;
    const plansRef = collection(db, 'artifacts', appId, 'users', user.uid, 'dietPlans');
    const unsub = onSnapshot(
      plansRef,
      (snapshot) => {
        const plans = {};
        snapshot.forEach((d) => {
          plans[d.id] = d.data();
        });
        setWeeklyPlans(plans);
      },
      (err) => console.error(err)
    );
    return () => unsub();
  }, [user, needsOnboarding]);

  // Push public stats for the Buddies leaderboard
  const syncPublicStats = async (profileToSync, planToSync) => {
    if (!user) return;
    try {
      const consumedPro =
        planToSync?.meals
          ?.filter((m) => m.completed)
          .reduce((sum, m) => sum + (m.protein || 0), 0) || 0;
      const workoutMins =
        planToSync?.workouts?.reduce((sum, w) => sum + (w.duration || 0), 0) || 0;
      const stats = {
        name: profileToSync.name,
        photoURL: profileToSync.photoURL || null,
        consumedPro,
        workoutMins,
      };
      await setDoc(
        doc(
          db,
          'artifacts',
          appId,
          'public',
          'data',
          'userStats',
          `${user.uid}_${selectedDate}`
        ),
        stats
      );
    } catch (e) {
      console.error('Sync Error', e);
    }
  };

  // Subscribe to multiple buddy stats
  useEffect(() => {
    const ids = userProfile.buddyIds || [];
    if (ids.length === 0) {
      setBuddiesData({});
      return;
    }
    const unsubs = ids.map((id) =>
      onSnapshot(
        doc(
          db,
          'artifacts',
          appId,
          'public',
          'data',
          'userStats',
          `${id}_${selectedDate}`
        ),
        (docSnap) => {
          setBuddiesData((prev) => ({
            ...prev,
            [id]: docSnap.exists() ? docSnap.data() : null,
          }));
        }
      )
    );
    return () => unsubs.forEach((unsub) => unsub());
  }, [userProfile.buddyIds, selectedDate]);

  const handleSaveProfile = async (fromOnboarding = true) => {
    if (!user) return;
    try {
      await setDoc(
        doc(db, 'artifacts', appId, 'users', user.uid, 'profile', 'data'),
        userProfile
      );
      syncPublicStats(userProfile, weeklyPlans[selectedDate]);
      if (fromOnboarding) {
        setNeedsOnboarding(false);
        setShowProjection(true);
      }
    } catch (e) {
      console.error(e);
    }
  };

  const handleGeneratePlan = async () => {
    if (!user) return;
    setIsGeneratingPlan(true);
    try {
      const dietText =
        userProfile.diet === 'veg'
          ? userProfile.eggs
            ? 'Vegetarian + Eggs'
            : 'STRICT Vegetarian'
          : 'Non-Vegetarian';

      // Ensure dietary variety by avoiding yesterday's meals
      const yesterdayStr = getYesterdayString(selectedDate);
      const yesterdayPlan = weeklyPlans[yesterdayStr];
      let varietyConstraint = '';
      if (yesterdayPlan?.meals) {
        const eatenNames = yesterdayPlan.meals.map((m) => m.name).join(', ');
        varietyConstraint = `CRITICAL RULE: DO NOT SUGGEST THESE MEALS (eaten yesterday): [${eatenNames}]. Ensure dietary variety.`;
      }

      const prompt = `Create a 1-day Indian diet plan for a ${userProfile.age}yr old ${userProfile.gender}, ${userProfile.weight}kg, ${userProfile.height}cm. Goal: ${userProfile.goal}. Diet: ${dietText}. Daily cost MUST NOT exceed ₹${userProfile.budget}. ${varietyConstraint} Provide Breakfast, Lunch, Snack, Dinner. Assign reminderTime.`;

      const plan = await callGeminiAPI(prompt, planSchema);
      plan.meals = plan.meals.map((m, i) => ({
        ...m,
        id: `meal-${Date.now()}-${i}`,
        completed: false,
      }));

      // Preserve any existing workout data for the day
      const existingPlan = weeklyPlans[selectedDate] || {};
      plan.workouts = existingPlan.workouts || [];
      plan.aiWorkout = existingPlan.aiWorkout || null;

      await setDoc(
        doc(db, 'artifacts', appId, 'users', user.uid, 'dietPlans', selectedDate),
        plan
      );
      syncPublicStats(userProfile, plan);
    } catch (e) {
      alert('Error generating plan.');
    } finally {
      setIsGeneratingPlan(false);
    }
  };

  const handleGenerateWorkout = async (environment, targetMuscles) => {
    if (!user) return;
    setIsGeneratingWorkouts(true);
    try {
      const prompt = `User profile: ${userProfile.age}yr old ${userProfile.gender}, ${userProfile.weight}kg. Goal: ${userProfile.goal}.
        Environment: ${environment === 'gym' ? 'Full Gym Equipment available' : 'No Gym / Home Workout (bodyweight or minimal equipment)'}.
        Target Muscles: ${targetMuscles}.
        Generate a single personalized workout routine for today based strictly on the target muscles and environment.
        Include 4 to 6 specific exercises with detailed step-by-step instructions. Make it engaging.`;

      const newWorkout = await callGeminiAPI(prompt, aiWorkoutSchema);

      const currentPlan = weeklyPlans[selectedDate] || { meals: [], workouts: [] };
      const updatedPlan = { ...currentPlan, aiWorkout: newWorkout };
      await setDoc(
        doc(db, 'artifacts', appId, 'users', user.uid, 'dietPlans', selectedDate),
        updatedPlan
      );
    } catch (e) {
      alert('Error generating workout.');
    } finally {
      setIsGeneratingWorkouts(false);
    }
  };

  const handleToggleMeal = async (mealId) => {
    if (!user || !weeklyPlans[selectedDate]) return;
    const currentPlan = weeklyPlans[selectedDate];
    const updatedPlan = {
      ...currentPlan,
      meals: currentPlan.meals.map((m) =>
        m.id === mealId ? { ...m, completed: !m.completed } : m
      ),
    };
    await setDoc(
      doc(db, 'artifacts', appId, 'users', user.uid, 'dietPlans', selectedDate),
      updatedPlan
    );
    syncPublicStats(userProfile, updatedPlan);
  };

  const handleLogMeal = async (newMeal, replaceMealId = null) => {
    if (!user) return;
    const currentPlan = weeklyPlans[selectedDate] || { meals: [], workouts: [] };
    let updatedMeals = currentPlan.meals || [];

    if (replaceMealId) {
      // Replace in-place, preserving the meal slot's type label
      updatedMeals = updatedMeals.map((m) =>
        m.id === replaceMealId ? { ...newMeal, type: m.type } : m
      );
    } else {
      updatedMeals = [...updatedMeals, newMeal];
    }

    const updatedPlan = { ...currentPlan, meals: updatedMeals };
    await setDoc(
      doc(db, 'artifacts', appId, 'users', user.uid, 'dietPlans', selectedDate),
      updatedPlan
    );

    // Close the recipe detail if the meal being viewed was replaced
    if (replaceMealId && viewingRecipe?.id === replaceMealId) setViewingRecipe(null);
    syncPublicStats(userProfile, updatedPlan);
  };

  const handleLogWorkout = async (newWorkout) => {
    if (!user) return;
    const currentPlan = weeklyPlans[selectedDate] || { meals: [], workouts: [] };
    const updatedPlan = {
      ...currentPlan,
      workouts: [...(currentPlan.workouts || []), newWorkout],
    };
    await setDoc(
      doc(db, 'artifacts', appId, 'users', user.uid, 'dietPlans', selectedDate),
      updatedPlan
    );
    syncPublicStats(userProfile, updatedPlan);
  };

  // Generate a single alternative meal that keeps the same budget & macros,
  // then update it in Firestore and refresh the recipe view.
  const handleSwapMeal = async (meal) => {
    if (!user || !weeklyPlans[selectedDate]) return;
    const dietText =
      userProfile.diet === 'veg'
        ? userProfile.eggs
          ? 'Vegetarian + Eggs'
          : 'STRICT Vegetarian'
        : 'Non-Vegetarian';

    const prompt = `Generate ONE alternative Indian ${meal.type} meal for a ${userProfile.age}yr old ${userProfile.gender}. Goal: ${userProfile.goal}. Diet: ${dietText}. Cost must be around ₹${meal.cost}. Calories around ${meal.calories}. Protein around ${meal.protein}g. MUST be different from: "${meal.name}". Return a plan with exactly 1 meal in the meals array.`;

    const result = await callGeminiAPI(prompt, planSchema);
    if (!result?.meals?.length) return;

    const swapped = {
      ...result.meals[0],
      id: meal.id,
      type: meal.type,
      completed: meal.completed,
    };

    const currentPlan = weeklyPlans[selectedDate];
    const updatedPlan = {
      ...currentPlan,
      meals: currentPlan.meals.map((m) => (m.id === meal.id ? swapped : m)),
    };

    await setDoc(
      doc(db, 'artifacts', appId, 'users', user.uid, 'dietPlans', selectedDate),
      updatedPlan
    );

    // Update the recipe detail view with the new meal
    setViewingRecipe(swapped);
  };

  // Stats used by the Buddies leaderboard
  const myPlan = weeklyPlans[selectedDate];
  const myStats = {
    consumedPro:
      myPlan?.meals?.filter((m) => m.completed).reduce((sum, m) => sum + (m.protein || 0), 0) || 0,
    workoutMins: myPlan?.workouts?.reduce((sum, w) => sum + (w.duration || 0), 0) || 0,
  };

  if (!authChecked)
    return (
      <div className="min-h-screen flex items-center justify-center bg-black">
        <Loader2 className="w-8 h-8 animate-spin text-lime-400" />
      </div>
    );

  return (
    <div className="min-h-screen bg-zinc-950 flex items-center justify-center p-0 sm:p-4 md:p-8 font-sans antialiased text-white selection:bg-lime-400/30">
      <div className="w-full max-w-md bg-black sm:rounded-[2.5rem] sm:shadow-2xl overflow-hidden relative sm:h-[850px] sm:max-h-[90vh] flex flex-col sm:border-[8px] border-zinc-900">
        {/* Desktop mock status bar */}
        <div className="hidden sm:flex justify-between items-center px-6 py-2 bg-transparent text-[10px] font-bold text-zinc-500 absolute top-0 w-full z-50 rounded-t-[1.8rem]">
          <span>9:41</span>
          <div className="flex gap-1.5 items-center">
            <div className="w-3 h-3 rounded-full bg-zinc-500"></div>
            <div className="w-3 h-3 rounded-full bg-zinc-500"></div>
            <div className="w-5 h-3 rounded-sm bg-zinc-500"></div>
          </div>
        </div>

        <div className="flex-1 overflow-y-auto overflow-x-hidden relative scrollbar-hide bg-black">
          {!user ? (
            <LoginScreen onLogin={() => {}} />
          ) : needsOnboarding ? (
            <OnboardingScreen
              userProfile={userProfile}
              setUserProfile={setUserProfile}
              onSaveProfile={() => handleSaveProfile(true)}
            />
          ) : showProjection ? (
            <ProjectionScreen
              userProfile={userProfile}
              onContinue={() => {
                setShowProjection(false);
                setCurrentTab('dashboard');
              }}
            />
          ) : (
            <>
              {currentTab === 'dashboard' && (
                <DashboardScreen
                  userProfile={userProfile}
                  selectedDate={selectedDate}
                  setSelectedDate={setSelectedDate}
                  weekDates={weekDates}
                  dietPlan={weeklyPlans[selectedDate]}
                  isGeneratingPlan={isGeneratingPlan}
                  onGeneratePlan={handleGeneratePlan}
                  onMealClick={setViewingRecipe}
                  onToggleMeal={handleToggleMeal}
                  onOpenLog={() => setLoggingContext({ isOpen: true, replaceId: null })}
                />
              )}
              {currentTab === 'groceries' && <GroceriesScreen />}
              {currentTab === 'workouts' && (
                <WorkoutsScreen
                  userProfile={userProfile}
                  onLogWorkout={handleLogWorkout}
                  aiWorkout={weeklyPlans[selectedDate]?.aiWorkout}
                  onGenerateWorkout={handleGenerateWorkout}
                  isGeneratingWorkout={isGeneratingWorkouts}
                />
              )}
              {currentTab === 'buddies' && (
                <BuddiesScreen
                  userProfile={userProfile}
                  setUserProfile={setUserProfile}
                  onSaveProfile={() => handleSaveProfile(false)}
                  userId={user.uid}
                  buddiesData={buddiesData}
                  myStats={myStats}
                />
              )}
              {currentTab === 'profile' && (
                <ProfileScreen
                  userProfile={userProfile}
                  setUserProfile={setUserProfile}
                  onSaveProfile={() => handleSaveProfile(false)}
                />
              )}
              {viewingRecipe && (
                <RecipeScreen
                  meal={viewingRecipe}
                  onBack={() => setViewingRecipe(null)}
                  onSwapMeal={handleSwapMeal}
                  onReplaceWithLog={(id) =>
                    setLoggingContext({ isOpen: true, replaceId: id })
                  }
                />
              )}

              {/* Bottom Navigation Bar */}
              <div className="fixed bottom-0 left-0 right-0 bg-zinc-900 border-t border-zinc-800 flex justify-between px-5 items-center py-4 max-w-md mx-auto z-40 pb-safe">
                <button
                  onClick={() => {
                    setCurrentTab('dashboard');
                    setViewingRecipe(null);
                  }}
                  className={`flex flex-col items-center gap-1.5 transition-colors ${
                    currentTab === 'dashboard' && !viewingRecipe
                      ? 'text-lime-400'
                      : 'text-zinc-500 hover:text-white'
                  }`}
                >
                  <Home className="w-6 h-6" />
                  <span className="text-[10px] font-bold">Home</span>
                </button>
                <button
                  onClick={() => {
                    setCurrentTab('groceries');
                    setViewingRecipe(null);
                  }}
                  className={`flex flex-col items-center gap-1.5 transition-colors ${
                    currentTab === 'groceries' ? 'text-lime-400' : 'text-zinc-500 hover:text-white'
                  }`}
                >
                  <ShoppingCart className="w-6 h-6" />
                  <span className="text-[10px] font-bold">Shop</span>
                </button>
                <button
                  onClick={() => {
                    setCurrentTab('workouts');
                    setViewingRecipe(null);
                  }}
                  className={`flex flex-col items-center gap-1.5 transition-colors ${
                    currentTab === 'workouts' ? 'text-lime-400' : 'text-zinc-500 hover:text-white'
                  }`}
                >
                  <Dumbbell className="w-6 h-6" />
                  <span className="text-[10px] font-bold">Train</span>
                </button>
                <button
                  onClick={() => {
                    setCurrentTab('buddies');
                    setViewingRecipe(null);
                  }}
                  className={`flex flex-col items-center gap-1.5 transition-colors ${
                    currentTab === 'buddies' ? 'text-lime-400' : 'text-zinc-500 hover:text-white'
                  }`}
                >
                  <Users className="w-6 h-6" />
                  <span className="text-[10px] font-bold">Buddies</span>
                </button>
                <button
                  onClick={() => {
                    setCurrentTab('profile');
                    setViewingRecipe(null);
                  }}
                  className={`flex flex-col items-center gap-1.5 transition-colors ${
                    currentTab === 'profile' ? 'text-lime-400' : 'text-zinc-500 hover:text-white'
                  }`}
                >
                  <User className="w-6 h-6" />
                  <span className="text-[10px] font-bold">Profile</span>
                </button>
              </div>

              {/* Modals */}
              {loggingContext.isOpen && (
                <LogFoodModal
                  onClose={() => setLoggingContext({ isOpen: false, replaceId: null })}
                  onLogMeal={handleLogMeal}
                  replaceMealId={loggingContext.replaceId}
                />
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}
