'use client';

import React, { useState, useEffect, useMemo, useRef } from 'react';
import {
  Trophy, Clock, Users, Settings, Play, Pause,
  RotateCcw, Search, Lock, Unlock, ShieldAlert, Loader2, Wifi, Trash2, Save, Download, X, Copy, ArrowRightLeft, Volume2, VolumeX, UserCheck, KeyRound, MessageSquare, Send, ShieldCheck, Edit2, BookOpen, Camera, DollarSign, CheckCircle2, AlertTriangle
} from 'lucide-react';
import { db } from './firebase';
import { ref, onValue, set, push } from 'firebase/database';
import confetti from 'canvas-confetti';
import { toPng } from 'html-to-image';

const POSITION_COLORS: Record<string, { bg: string; text: string; border: string; badge: string }> = {
  QB: { bg: 'bg-red-950/90', text: 'text-red-200', border: 'border-red-600', badge: 'bg-red-600 text-white' },
  RB: { bg: 'bg-emerald-950/90', text: 'text-emerald-200', border: 'border-emerald-600', badge: 'bg-emerald-600 text-white' },
  WR: { bg: 'bg-blue-950/90', text: 'text-blue-200', border: 'border-blue-600', badge: 'bg-blue-600 text-white' },
  TE: { bg: 'bg-orange-950/90', text: 'text-orange-200', border: 'border-orange-500', badge: 'bg-orange-500 text-white' },
  K: { bg: 'bg-amber-950/90', text: 'text-amber-200', border: 'border-amber-500', badge: 'bg-amber-500 text-white' },
  DEF: { bg: 'bg-purple-950/90', text: 'text-purple-200', border: 'border-purple-600', badge: 'bg-purple-600 text-white' },
};

// --- COMMISSIONER SECRET PIN ---
const COMMISSIONER_PIN = '0021';
const BUY_IN_AMOUNT = 25;

interface Player {
  id: string;
  name: string;
  position: 'QB' | 'RB' | 'WR' | 'TE' | 'K' | 'DEF';
  team: string;
  adp: number;
  injury_status?: string | null;
  bye?: number | null;
}

interface DraftPick {
  round: number;
  pickNumber: number;
  teamId: number;
  player: Player | null;
  isKeeper?: boolean;
}

interface Team {
  id: number;
  name: string;
  owner: string;
}

interface ChatMessage {
  id: string;
  teamId: number;
  text: string;
  timestamp: number;
}

const generateTeams = (count: number): Team[] =>
  Array.from({ length: count }, (_, i) => ({
    id: i + 1,
    name: i === 0 ? 'Big Pick Energy' : `Team ${i + 1}`,
    owner: `Owner ${i + 1}`
  }));

const generateDefaultOrder = (teamCount: number, rounds: number): number[][] => {
  const order: number[][] = [];
  const base = Array.from({ length: teamCount }, (_, i) => i + 1);
  for (let r = 0; r < rounds; r++) {
    order.push(r % 2 === 0 ? [...base] : [...base].reverse());
  }
  return order;
};

const getSplitName = (fullName: string) => {
  if (!fullName) return { firstName: '', lastName: '' };
  const parts = fullName.trim().split(' ');
  if (parts.length === 1) return { firstName: '', lastName: parts[0] };
  const firstName = parts[0];
  const lastName = parts.slice(1).join(' ');
  return { firstName, lastName };
};

export default function FantasyDraftApp() {
  const [isUnlocked, setIsUnlocked] = useState<boolean>(false);
  const [targetDate] = useState<Date>(new Date('2026-09-07T12:30:00-05:00'));
  const [timeLeft, setTimeLeft] = useState({ days: 0, hours: 0, minutes: 0, seconds: 0 });
  const [isLoadingAPI, setIsLoadingAPI] = useState<boolean>(true);

  // --- League Settings State ---
  const [totalRounds, setTotalRounds] = useState<number>(15);
  const [teams, setTeams] = useState<Team[]>(generateTeams(10));
  const [teamPins, setTeamPins] = useState<Record<number, string>>({});
  const [paidTeams, setPaidTeams] = useState<Record<number, boolean>>({});

  const [tempRounds, setTempRounds] = useState<number>(15);
  const [tempTeams, setTempTeams] = useState<Team[]>(generateTeams(10));
  const [customOrder, setCustomOrder] = useState<number[][]>(generateDefaultOrder(10, 15));
  const [editingRound, setEditingRound] = useState<number>(1);

  const [players, setPlayers] = useState<Player[]>([]);
  const [picks, setPicks] = useState<DraftPick[]>([]);
  const [currentPickIndex, setCurrentPickIndex] = useState<number>(0);
  const prevPickIndexRef = useRef<number>(0);

  const [isDraftActive, setIsDraftActive] = useState<boolean>(false);
  const [draftMode, setDraftMode] = useState<'live' | 'mock'>('live');

  // --- UI Layout State ---
  const [isPlayersOpen, setIsPlayersOpen] = useState<boolean>(false);
  const [isChatOpen, setIsChatOpen] = useState<boolean>(false);

  // --- User Identity State ---
  const [userTeamId, setUserTeamId] = useState<number | null>(null);
  const [showLoginModal, setShowLoginModal] = useState<boolean>(false);
  const [loginStep, setLoginStep] = useState<'select' | 'pin'>('select');
  const [loginTargetTeam, setLoginTargetTeam] = useState<Team | null>(null);
  const [loginPin, setLoginPin] = useState<string>('');
  const [loginError, setLoginError] = useState<string>('');

  // --- Authorization & Commish Controls ---
  const [isCommissioner, setIsCommissioner] = useState<boolean>(false);
  const [showCommishPinModal, setShowCommishPinModal] = useState<boolean>(false);
  const [inputPin, setInputPin] = useState<string>('');
  const [pinError, setPinError] = useState<string>('');
  const [showCommishTools, setShowCommishTools] = useState<boolean>(false);

  const [defaultPickTime, setDefaultPickTime] = useState<number>(90);
  const [clockTime, setClockTime] = useState<number>(90);

  const [searchQuery, setSearchQuery] = useState<string>('');
  const [selectedPos, setSelectedPos] = useState<string>('ALL');

  // --- Roster Modal & Editing State ---
  const [viewingTeam, setViewingTeam] = useState<Team | null>(null);
  const [isEditingName, setIsEditingName] = useState<boolean>(false);
  const [editNameValue, setEditNameValue] = useState<string>('');

  // --- Bylaws Modal State ---
  const [showBylawsModal, setShowBylawsModal] = useState<boolean>(false);

  // Upgraded Assign Modal State
  const [assignModal, setAssignModal] = useState<{ isOpen: boolean, player: Player | null, teamId: number, pickNumber: number, isKeeper: boolean }>({
    isOpen: false, player: null, teamId: 1, pickNumber: 1, isKeeper: false
  });

  // --- Chat State ---
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [newMessage, setNewMessage] = useState<string>('');
  const chatEndRef = useRef<HTMLDivElement>(null);

  // --- Audio State ---
  const [isMuted, setIsMuted] = useState<boolean>(false);
  const isMutedRef = useRef<boolean>(false);
  const panicAudioRef = useRef<HTMLAudioElement | null>(null);

  // --- Screenshot State & Ref ---
  const boardRef = useRef<HTMLDivElement>(null);
  const [isCapturing, setIsCapturing] = useState<boolean>(false);

  const toggleMute = () => {
    setIsMuted(!isMuted);
    isMutedRef.current = !isMuted;
  };

  const playDraftSound = () => {
    if (isMutedRef.current) return;
    const audio = new Audio('/draft-chime.mp3');
    audio.play().catch(() => console.log('Waiting for user interaction'));
  };

  const triggerConfetti = () => {
    const duration = 5 * 1000;
    const animationEnd = Date.now() + duration;
    const defaults = { startVelocity: 30, spread: 360, ticks: 60, zIndex: 1000 };
    const randomInRange = (min: number, max: number) => Math.random() * (max - min) + min;

    const interval = setInterval(function () {
      const timeLeft = animationEnd - Date.now();
      if (timeLeft <= 0) return clearInterval(interval as NodeJS.Timeout);
      const particleCount = 50 * (timeLeft / duration);
      confetti({ ...defaults, particleCount, origin: { x: randomInRange(0.1, 0.3), y: Math.random() - 0.2 } });
      confetti({ ...defaults, particleCount, origin: { x: randomInRange(0.7, 0.9), y: Math.random() - 0.2 } });
    }, 250);
  };

  const handleDownloadBoard = async () => {
    if (!boardRef.current) return;
    setIsCapturing(true);
    try {
      const dataUrl = await toPng(boardRef.current, {
        backgroundColor: '#0f172a',
        pixelRatio: 2,
        width: boardRef.current.scrollWidth,
        height: boardRef.current.scrollHeight,
        style: { transform: 'none' }
      });
      const link = document.createElement('a');
      link.href = dataUrl;
      link.download = `JMs_FFL_DraftBoard_${new Date().getFullYear()}.png`;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
    } catch (err) {
      console.error("Failed to capture board:", err);
      alert("Failed to capture the board. Please try again.");
    } finally {
      setIsCapturing(false);
    }
  };

  // Fetch API Players
  useEffect(() => {
    async function fetchSleeperPlayers() {
      try {
        const res = await fetch('/api/players');
        const data = await res.json();
        setPlayers(data);
        setIsLoadingAPI(false);
      } catch (error) {
        console.error('Failed to load Sleeper players:', error);
        setIsLoadingAPI(false);
      }
    }
    fetchSleeperPlayers();
  }, []);

  // Firebase Draft State Sync
  useEffect(() => {
    const draftRef = ref(db, 'draftState');
    const unsubscribe = onValue(draftRef, (snapshot) => {
      const data = snapshot.val();
      if (data) {
        if (data.picks) setPicks(data.picks);
        if (data.teams) setTeams(data.teams);
        if (data.totalRounds) setTotalRounds(data.totalRounds);
        if (data.customOrder) setCustomOrder(data.customOrder);
        if (data.defaultPickTime) setDefaultPickTime(data.defaultPickTime);
        if (data.teamPins) setTeamPins(data.teamPins); else setTeamPins({});
        if (data.paidTeams) setPaidTeams(data.paidTeams); else setPaidTeams({});
        if (typeof data.isDraftActive === 'boolean') setIsDraftActive(data.isDraftActive);

        if (typeof data.currentPickIndex === 'number') {
          if (data.currentPickIndex > prevPickIndexRef.current) {
            if (data.currentPickIndex >= data.picks.length) triggerConfetti();
            else playDraftSound();
          }
          prevPickIndexRef.current = data.currentPickIndex;
          setCurrentPickIndex(data.currentPickIndex);
        }
      } else {
        initializeBoard(teams, totalRounds, customOrder, defaultPickTime);
      }
    });
    return () => unsubscribe();
  }, []);

  // Firebase Chat Sync
  useEffect(() => {
    const chatRef = ref(db, 'draftChat');
    const unsubscribe = onValue(chatRef, (snapshot) => {
      const data = snapshot.val();
      if (data) {
        const msgList = Object.keys(data).map(key => ({
          id: key,
          ...data[key]
        })).sort((a: ChatMessage, b: ChatMessage) => a.timestamp - b.timestamp);
        setMessages(msgList);
      } else {
        setMessages([]);
      }
    });
    return () => unsubscribe();
  }, []);

  // Auto-scroll chat to bottom (Localized to prevent page jumping)
  useEffect(() => {
    if (chatEndRef.current && chatEndRef.current.parentElement) {
      chatEndRef.current.parentElement.scrollTo({
        top: chatEndRef.current.parentElement.scrollHeight,
        behavior: 'smooth'
      });
    }
  }, [messages, isChatOpen]);

  // Sync editing name value when roster modal opens
  useEffect(() => {
    if (viewingTeam) {
      setEditNameValue(viewingTeam.name);
      setIsEditingName(false);
    }
  }, [viewingTeam]);

  const initializeBoard = (activeTeams: Team[], rounds: number, orderMatrix: number[][], currentDefaultPickTime: number = 90) => {
    const newPicks: DraftPick[] = [];
    let overallPick = 1;
    for (let r = 0; r < rounds; r++) {
      const roundOrder = orderMatrix[r] || Array.from({ length: activeTeams.length }, (_, i) => i + 1);
      roundOrder.forEach((teamId) => {
        newPicks.push({ round: r + 1, pickNumber: overallPick++, teamId, player: null });
      });
    }
    set(ref(db, 'draftState'), {
      picks: newPicks,
      currentPickIndex: 0,
      isDraftActive: false,
      teams: activeTeams,
      totalRounds: rounds,
      customOrder: orderMatrix,
      defaultPickTime: currentDefaultPickTime,
      paidTeams: {}
    });
  };

  const updateFirebaseState = (newPicks: DraftPick[], newIndex: number, activeState: boolean) => {
    set(ref(db, 'draftState/picks'), newPicks);
    set(ref(db, 'draftState/currentPickIndex'), newIndex);
    set(ref(db, 'draftState/isDraftActive'), activeState);
  };

  const getNextEmptyPick = (currentPicks: DraftPick[], startIdx: number) => {
    let idx = startIdx;
    while (idx < currentPicks.length && currentPicks[idx].player) {
      idx++;
    }
    return idx;
  };

  const toggleDraftStatus = () => {
    let nextIdx = currentPickIndex;
    if (!isDraftActive) {
      nextIdx = getNextEmptyPick(picks, currentPickIndex);
    }
    updateFirebaseState(picks, nextIdx, !isDraftActive);
  };

  const togglePaidStatus = (teamId: number) => {
    const isCurrentlyPaid = !!paidTeams[teamId];
    set(ref(db, `draftState/paidTeams/${teamId}`), !isCurrentlyPaid);
  };

  useEffect(() => {
    let timer: NodeJS.Timeout;
    if (isDraftActive && clockTime > 0 && currentPickIndex < picks.length) {
      timer = setInterval(() => setClockTime((prev) => {
        if (prev === 11 && !isMutedRef.current) {
          if (panicAudioRef.current) {
            panicAudioRef.current.pause();
            panicAudioRef.current.currentTime = 0;
          }
          panicAudioRef.current = new Audio('/tick.mp3');
          panicAudioRef.current.play().catch(() => { });
        }
        return prev - 1;
      }), 1000);
    } else if (clockTime === 0 && isDraftActive && currentPickIndex < picks.length) {
      const nextIndex = getNextEmptyPick(picks, currentPickIndex + 1);
      updateFirebaseState(picks, nextIndex, isDraftActive);
      setClockTime(defaultPickTime);
    }
    return () => clearInterval(timer);
  }, [isDraftActive, clockTime, currentPickIndex, picks, defaultPickTime]);

  useEffect(() => {
    if (clockTime > 10 || !isDraftActive) {
      if (panicAudioRef.current) {
        panicAudioRef.current.pause();
        panicAudioRef.current.currentTime = 0;
      }
    }
  }, [clockTime, isDraftActive]);

  useEffect(() => {
    if (draftMode === 'mock' && isDraftActive && currentPickIndex < picks.length) {
      const currentPick = picks[currentPickIndex];
      if (currentPick && currentPick.teamId !== userTeamId) {
        const timeout = setTimeout(() => handleAutoPick(), 1200);
        return () => clearTimeout(timeout);
      }
    }
  }, [currentPickIndex, isDraftActive, draftMode, userTeamId, picks]);

  useEffect(() => {
    const interval = setInterval(() => {
      const distance = targetDate.getTime() - new Date().getTime();
      if (distance < 0) {
        setIsUnlocked(true);
        clearInterval(interval);
      } else {
        setTimeLeft({
          days: Math.floor(distance / (1000 * 60 * 60 * 24)),
          hours: Math.floor((distance % (1000 * 60 * 60 * 24)) / (1000 * 60 * 60)),
          minutes: Math.floor((distance % (1000 * 60 * 60)) / (1000 * 60)),
          seconds: Math.floor((distance % (1000 * 60)) / 1000),
        });
      }
    }, 1000);
    return () => clearInterval(interval);
  }, [targetDate]);

  const getEnrichedPlayer = (player: Player | null): Player | null => {
    if (!player) return null;
    const master = players.find((p) => p.id === player.id);
    if (!master) return player;
    return {
      ...player,
      bye: master.bye ?? player.bye,
      injury_status: master.injury_status ?? player.injury_status,
      team: master.team || player.team,
      position: master.position || player.position
    };
  };

  const currentPick = picks[currentPickIndex];
  const currentPickingTeam = teams.find((t) => t.id === currentPick?.teamId);
  const activeUserTeam = userTeamId ? teams.find((t) => t.id === userTeamId) : null;
  const myFirstEmpty = userTeamId ? picks.findIndex(p => p.teamId === userTeamId && !p.player) : -1;
  const isMyTurnOrSkipped = myFirstEmpty !== -1 && myFirstEmpty <= currentPickIndex;

  const paidCount = Object.values(paidTeams).filter(Boolean).length;
  const totalPot = paidCount * BUY_IN_AMOUNT;
  const maxPot = teams.length * BUY_IN_AMOUNT;

  const recentPositions = useMemo(() => {
    const drafted = picks.filter(p => p.player).sort((a, b) => b.pickNumber - a.pickNumber).slice(0, 10);
    return drafted.reduce((acc, pick) => {
      if (pick.player) {
        acc[pick.player.position] = (acc[pick.player.position] || 0) + 1;
      }
      return acc;
    }, {} as Record<string, number>);
  }, [picks]);

  const availablePlayers = useMemo(() => {
    const draftedIds = new Set(picks.map((p) => p.player?.id).filter(Boolean));
    return players
      .filter((p) => !draftedIds.has(p.id))
      .filter((p) => selectedPos === 'ALL' || p.position === selectedPos)
      .filter((p) => p.name.toLowerCase().includes(searchQuery.toLowerCase()) || p.team.toLowerCase().includes(searchQuery.toLowerCase()))
      .sort((a, b) => a.adp - b.adp);
  }, [players, picks, selectedPos, searchQuery]);

  const handleSelectPlayer = (player: Player) => {
    let targetIndex = currentPickIndex;
    if (!isCommissioner) {
      if (myFirstEmpty !== -1 && myFirstEmpty <= currentPickIndex) {
        targetIndex = myFirstEmpty;
      } else {
        return;
      }
    } else {
      if (targetIndex >= picks.length) {
        targetIndex = picks.findIndex(p => !p.player);
      }
    }
    if (targetIndex >= picks.length || targetIndex === -1) return;

    const updatedPicks = [...picks];
    updatedPicks[targetIndex] = { ...updatedPicks[targetIndex], player };

    if (targetIndex < currentPickIndex) {
      set(ref(db, 'draftState/picks'), updatedPicks);
    } else {
      const nextIndex = getNextEmptyPick(updatedPicks, currentPickIndex + 1);
      updateFirebaseState(updatedPicks, nextIndex, isDraftActive);
      setClockTime(defaultPickTime);
    }
    setIsPlayersOpen(false);
  };

  const handleAutoPick = () => { if (availablePlayers.length > 0) handleSelectPlayer(availablePlayers[0]); };

  const handleUndoPick = () => {
    if (currentPickIndex === 0) return;
    let prevIndex = currentPickIndex - 1;
    while (prevIndex > 0 && picks[prevIndex].isKeeper) {
      prevIndex--;
    }
    const updatedPicks = [...picks];
    updatedPicks[prevIndex] = { ...updatedPicks[prevIndex], player: null };
    updateFirebaseState(updatedPicks, prevIndex, isDraftActive);
    setClockTime(defaultPickTime);
  };

  const handleSaveAssignment = () => {
    if (!assignModal.player) return;
    const updatedPicks = [...picks];
    const targetIndex = updatedPicks.findIndex(p => p.pickNumber === assignModal.pickNumber);

    if (targetIndex !== -1) {
      updatedPicks[targetIndex] = {
        ...updatedPicks[targetIndex],
        player: assignModal.player,
        isKeeper: assignModal.isKeeper
      };
      set(ref(db, 'draftState/picks'), updatedPicks);
      setAssignModal({ ...assignModal, isOpen: false });
      setIsPlayersOpen(false);
    }
  };

  const handleManualRemovePlayer = (pickIndex: number) => {
    const updatedPicks = [...picks];
    updatedPicks[pickIndex] = { ...updatedPicks[pickIndex], player: null, isKeeper: false };
    set(ref(db, 'draftState/picks'), updatedPicks);
  };

  const handleResetDraft = () => {
    if (window.confirm("Are you sure you want to reset the board? Keepers, team names, and custom order will be preserved.")) {
      const resetPicks = picks.map((p) => {
        if (p.isKeeper) return p;
        return { ...p, player: null };
      });
      const startingIndex = getNextEmptyPick(resetPicks, 0);
      updateFirebaseState(resetPicks, startingIndex, false);
      prevPickIndexRef.current = startingIndex;
      setClockTime(defaultPickTime);
    }
  };

  const handleApplySettings = () => {
    if (window.confirm("Applying new settings will reset the current draft board. Continue?")) {
      const existingKeepers = picks.filter(p => p.isKeeper && p.player);
      const newPicks: DraftPick[] = [];
      let overallPick = 1;

      for (let r = 0; r < tempRounds; r++) {
        const roundOrder = customOrder[r] || Array.from({ length: tempTeams.length }, (_, i) => i + 1);
        roundOrder.forEach((teamId) => {
          const matchingKeeper = existingKeepers.find(k => k.teamId === teamId && k.round === (r + 1));
          newPicks.push({
            round: r + 1, pickNumber: overallPick++, teamId,
            player: matchingKeeper ? matchingKeeper.player : null,
            isKeeper: matchingKeeper ? true : false
          });
        });
      }

      set(ref(db, 'draftState'), {
        picks: newPicks, currentPickIndex: 0, isDraftActive: false,
        teams: tempTeams, totalRounds: tempRounds, customOrder: customOrder,
        defaultPickTime: defaultPickTime, paidTeams: paidTeams
      });

      prevPickIndexRef.current = 0;
      setClockTime(defaultPickTime);
      setShowCommishTools(false);
    }
  };

  const handleSaveTeamName = () => {
    if (!editNameValue.trim() || !viewingTeam) return;
    const updatedTeams = teams.map(t => t.id === viewingTeam.id ? { ...t, name: editNameValue.trim() } : t);
    set(ref(db, 'draftState/teams'), updatedTeams);
    setViewingTeam({ ...viewingTeam, name: editNameValue.trim() });
    setIsEditingName(false);
  };

  const handleExportCSV = () => {
    const headers = ['Overall Pick', 'Round', 'Fantasy Team', 'Player Name', 'Position', 'NFL Team', 'Keeper'];
    const rows = picks.map(p => {
      const enriched = getEnrichedPlayer(p.player);
      const teamName = teams.find(t => t.id === p.teamId)?.name || 'Unknown';
      const playerName = enriched ? enriched.name : 'Empty';
      const pos = enriched ? enriched.position : '';
      const nflTeam = enriched ? enriched.team : '';
      const keeperStatus = p.isKeeper ? 'Yes' : 'No';
      return `"${p.pickNumber}","${p.round}","${teamName}","${playerName}","${pos}","${nflTeam}","${keeperStatus}"`;
    });

    const csvContent = [headers.join(','), ...rows].join('\n');
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.setAttribute('download', 'draft_results.csv');
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  const handleSendMessage = (e: React.FormEvent) => {
    e.preventDefault();
    if (!newMessage.trim() || userTeamId === null) return;

    const chatRef = ref(db, 'draftChat');
    push(chatRef, {
      teamId: userTeamId,
      text: newMessage.trim(),
      timestamp: Date.now()
    });
    setNewMessage('');
  };

  const handlePinSubmit = () => {
    if (!loginTargetTeam) return;
    const existingPin = teamPins[loginTargetTeam.id];

    if (existingPin) {
      if (loginPin === existingPin) {
        setUserTeamId(loginTargetTeam.id);
        closeLoginModal();
      } else {
        setLoginError("Incorrect PIN.");
      }
    } else {
      if (loginPin.length >= 4) {
        set(ref(db, `draftState/teamPins/${loginTargetTeam.id}`), loginPin);
        setUserTeamId(loginTargetTeam.id);
        closeLoginModal();
      } else {
        setLoginError("PIN must be at least 4 digits.");
      }
    }
  };

  const closeLoginModal = () => {
    setShowLoginModal(false);
    setLoginStep('select');
    setLoginTargetTeam(null);
    setLoginPin('');
    setLoginError('');
  };

  const handleCommishAuth = () => {
    if (inputPin === COMMISSIONER_PIN) {
      setIsCommissioner(true);
      setTempTeams([...teams]);
      setTempRounds(totalRounds);

      if (!isUnlocked) {
        setIsUnlocked(true);
        setShowCommishTools(false);
      } else {
        setShowCommishTools(true);
      }
      setShowCommishPinModal(false);
      setInputPin('');
      setPinError('');
    } else {
      setPinError('Invalid Commissioner Passcode');
    }
  };

  const toggleCommishPanel = () => {
    if (isCommissioner) {
      if (!showCommishTools) {
        setTempTeams([...teams]);
        setTempRounds(totalRounds);
      }
      setShowCommishTools(!showCommishTools);
    } else {
      setShowCommishPinModal(true);
    }
  };

  const closeCommishPinModal = () => {
    setShowCommishPinModal(false);
    setInputPin('');
    setPinError('');
  };

  const updateTempTeamCount = (count: number) => {
    if (count < 2 || count > 32) return;
    setTempTeams(generateTeams(count));
    setCustomOrder(generateDefaultOrder(count, tempRounds));
    setEditingRound(1);
  };

  const handleRoundsChange = (rounds: number) => {
    if (rounds < 1 || rounds > 40) return;
    setTempRounds(rounds);

    const newOrder = [...customOrder];
    if (rounds > newOrder.length) {
      for (let i = newOrder.length; i < rounds; i++) {
        newOrder.push(i % 2 === 0 ? [...newOrder[0]] : [...newOrder[0]].reverse());
      }
    } else if (rounds < newOrder.length) {
      newOrder.length = rounds;
    }
    setCustomOrder(newOrder);
    if (editingRound > rounds) setEditingRound(rounds);
  };

  const updateTempTeamName = (index: number, newName: string) => {
    const updated = [...tempTeams];
    updated[index].name = newName;
    setTempTeams(updated);
  };

  const updateCustomOrderSlot = (roundIdx: number, slotIdx: number, newTeamId: number) => {
    const updated = [...customOrder];
    updated[roundIdx][slotIdx] = newTeamId;
    setCustomOrder(updated);
  };

  const handleCopyPrevRound = () => {
    if (editingRound <= 1) return;
    const updated = [...customOrder];
    updated[editingRound - 1] = [...updated[editingRound - 2]];
    setCustomOrder(updated);
  };

  const handleReverseCurrentRound = () => {
    const updated = [...customOrder];
    updated[editingRound - 1] = [...updated[editingRound - 1]].reverse();
    setCustomOrder(updated);
  };

  // --- BYLAWS MODAL ---
  const renderBylawsModal = () => {
    if (!showBylawsModal) return null;
    return (
      <div className="fixed inset-0 z-50 bg-slate-950/90 backdrop-blur-sm flex items-center justify-center p-4">
        <div className="bg-slate-900 border border-slate-700 rounded-2xl w-full max-w-2xl shadow-2xl overflow-hidden flex flex-col max-h-[85vh]">
          <div className="p-4 border-b border-slate-800 bg-slate-950 flex justify-between items-center">
            <h3 className="font-black text-lg text-white flex items-center gap-2">
              <BookOpen className="w-5 h-5 text-blue-400" /> League Bylaws & Rules
            </h3>
            <button onClick={() => setShowBylawsModal(false)} className="p-1 hover:bg-slate-800 rounded-lg text-slate-400 hover:text-white transition">
              <X className="w-5 h-5" />
            </button>
          </div>
          <div className="p-6 overflow-y-auto space-y-4 text-slate-300 text-sm leading-relaxed">
            <h4 className="font-bold text-white text-base">Article I, Agreement to the By-laws</h4>
            <p>By providing the entry fee, it is understood that you have read the By-laws below and you are agreeing to them. It is also understood that you are aware of the roster positions, settings and scoring setup for the current league year.</p>

            <h4 className="font-bold text-white text-base">Article II, League Entry</h4>
            <p>Entry Fee: $25. Dues are required no later than 10 days before the draft date. Failure to pay by the deadline (10 days before draft day) will lead to your replacement in the league. The Commissioner will take over managing the delinquent teams and is responsible for finding a replacement team.</p>

            <h4 className="font-bold text-white text-base">Article III, Prize Payout Structure</h4>
            <p>Total prize pool is $300. The league awards cash prizes to the top 3 teams who reach the Championship Playoff Bracket. Here is how we will award the winning teams:</p>
            <ul className="list-disc pl-5 space-y-1">
              <li>1st: $175</li>
              <li>2nd: $75</li>
              <li>3rd: $50</li>
            </ul>

            <h4 className="font-bold text-white text-base">Article IV, Playoff Configuration</h4>
            <p>Our league will implement a 6-team Championship Playoff Bracket. The top 6 teams will be determined first by win/loss record and total points will be used as a tie breaker if necessary. We will also implement a 6-team Loser Playoff Bracket. The final standings of the Loser Bracket will determine the top 6 draft positions in the following year’s fantasy draft. Playoffs are Weeks 15, 16 & 17.</p>

            <h4 className="font-bold text-white text-base">Article V, Determining Draft Order</h4>
            <p>Starting for League Year 2020-2021, the draft position for each fantasy team will be determined based on Championship/Loser playoff results from the previous year. If there is a Supplemental Draft, that order will be determined by previous year standings.</p>
            <p className="font-semibold text-white mt-2">LOSER BRACKET RESULTS:</p>
            <ul className="list-disc pl-5 space-y-1">
              <li>1st Place Finish = 1st Draft Position</li>
              <li>2nd Place Finish = 2nd Draft Position</li>
              <li>3rd Place Finish = 3rd Draft Position</li>
              <li>4th Place Finish = 4th Draft Position</li>
              <li>5th Place Finish = 5th Draft Position</li>
              <li>6th Place Finish = 6th Draft Position</li>
            </ul>
            <p className="font-semibold text-white mt-2">CHAMPIONSHIP BRACKET RESULTS:</p>
            <ul className="list-disc pl-5 space-y-1">
              <li>6th Place Finish = 7th Draft Position</li>
              <li>5th Place Finish = 8th Draft Position</li>
              <li>4th Place Finish = 9th Draft Position</li>
              <li>3rd Place Finish = 10th Draft Position</li>
              <li>2nd Place Finish = 11th Draft Position</li>
              <li>1st Place Finish = 12th Draft Position</li>
            </ul>
            <p className="mt-2">Any new teams which join the league will draft in the position of the team they are taking over.</p>
            <p className="mt-2"><strong className="text-white">Refresh/Reset years:</strong> The only time we will do a refresh/reset is every three years (2022, 2025, 2028, etc). During a reset year, the above draft order determination isn’t followed. All picks will be randomized and keepers are thrown back into the player pool until the next reset year.</p>

            <h4 className="font-bold text-white text-base">Article VI, Keepers</h4>
            <p>Starting for League Year 2020-2021, you will be allowed to keep a minimum of 1 and a maximum of 2 keepers. If you choose to keep the maximum (2) keepers, you will be beginning your draft in the 3rd round and not be entered in a supplemental draft. If you choose to keep the minimum (1) keeper, you will be beginning your draft in the 2nd round and will be entered into the supplemental draft. The supplemental draft order will be positioned based on how you finished the prior year starting with highest standing.</p>
            <p className="mt-2">Keepers will be locked 10 days before the draft. You can choose your keeper as early or as late as you’d like before the deadline and can do so through the Yahoo! league page for your team by hovering over My Team &gt; Choose Keepers. Any keepers not selected by the deadline will be selected by the Commissioner. In the event you have a keeper get injured after the selection cutoff, but before the draft, you can choose another keeper or join the supplemental draft.</p>
            <p className="mt-2"><strong className="text-white">Refresh/Reset years:</strong> During a reset year (2022, 2025, 2028, etc), keepers from the previous year aren’t kept. All picks will be randomized and keepers are thrown back into the player pool.</p>

            <h4 className="font-bold text-white text-base">Article VII, Waiver Wire</h4>
            <p>We are using FAAB (Free Agency Acquisition Bucks) this season. Each manager is given a budget to bid on unclaimed players that are on waivers. The budget will be $150 for the entirety of the season.</p>
            <ul className="list-disc pl-5 space-y-1">
              <li>Bids are blind, so other managers can't see what your bid is.</li>
              <li>Your bid can range from $0 to the remainder of your budget.</li>
              <li>Highest bid at the end of the waiver period wins the player.</li>
              <li>The winning bid is removed from that manager's budget.</li>
              <li>Ties are broken by Continual Rolling List waiver priority.</li>
            </ul>

            <h4 className="font-bold text-white text-base">Article VIII, Trade Guidelines</h4>
            <p>For a trade to be granted in a given week, it must be accepted through Yahoo’s site no later than 24 hours before game time of all the players in the trade. This gives all owners 24 hours to review the trade before the games begin. Any trades that are submitted through the website within 24 hours of game time will be set for the next week. Players who have already played on a given week cannot be traded until the following week as well.</p>
            <p className="mt-2">Once accepted through Yahoo, a trade cannot be withdrawn by one party due to a player injury, suspension or any other unforeseen circumstance. The only way a trade can be voided is if it is withdrawn by BOTH parties before the trade is granted. During the 24-hour trade acceptance period, all owners (except those involved in the trade) will be given the opportunity to veto the trade. However, those owners who choose to veto the trade MUST make a valid case to the Commissioner for why the trade should not be granted. Final decision will be made by the Commissioner.</p>

            <h4 className="font-bold text-white text-base">Article IX, Draft Day</h4>
            <p>We will be using www.jmsffl.com to perform the live draft (Subject to change seasonally). You must be present, in person, to take part in the live draft. If you cannot attend the draft in person, you will forfeit your rights to the team. The Commissioner will take over the team and be responsible for finding a replacement team before draft day.</p>
            <p className="font-semibold text-white mt-2">EXCEPTIONS:</p>
            <ol className="list-decimal pl-5 space-y-1">
              <li>You live more than 2 hours away</li>
              <li>You will be traveling during the day and advance notice was given</li>
              <li>Acts of God</li>
            </ol>

            <h4 className="font-bold text-white text-base">Article X, Creating New League Rules</h4>
            <p>When a league dispute arises which has not been addressed in the leagues By-laws, a discussion will ensue on possible resolutions to the dispute. Based on these discussions, the Commissioner will create a poll so that owners can vote on an appropriate course of action. The league will follow the course of action based on the league votes. Also, a new rule will be created in the By-laws based on the results of the poll so that similar disputes will be resolved in the same manner.</p>

            <h4 className="font-bold text-white text-base">Article XI, Refunds, Desertion, Violations</h4>
            <p>Refunds will not be granted if By-laws are broken or there is desertion of a team.</p>

            <h4 className="font-bold text-white text-base">Article XII</h4>
            <p>The title/role of Commissioner is non-transferable.</p>
          </div>
        </div>
      </div>
    );
  };

  // --- LOGIN MODAL WITH DUES GATEKEEPER ---
  const renderLoginModal = () => {
    if (!showLoginModal) return null;
    const isTargetPaid = loginTargetTeam ? !!paidTeams[loginTargetTeam.id] : false;

    return (
      <div className="fixed inset-0 z-50 bg-slate-950/90 backdrop-blur-sm flex items-center justify-center p-4">
        <div className="bg-slate-900 border border-slate-700 rounded-2xl w-full max-w-md shadow-2xl overflow-hidden">
          <div className="p-4 border-b border-slate-800 bg-slate-950 flex justify-between items-center">
            <h3 className="font-black text-lg text-white flex items-center gap-2">
              <UserCheck className="w-5 h-5 text-blue-400" />
              {loginStep === 'select' ? 'Team Manager Login' : loginTargetTeam?.name}
            </h3>
            <button onClick={closeLoginModal} className="p-1 hover:bg-slate-800 rounded-lg text-slate-400 hover:text-white transition">
              <X className="w-5 h-5" />
            </button>
          </div>

          <div className="p-5 space-y-3">
            {loginStep === 'select' ? (
              <>
                <p className="text-xs text-slate-400 mb-2">Select your team below. Dues must be verified by the Commissioner before logging in or creating a PIN.</p>
                <div className="grid grid-cols-1 gap-2 max-h-80 overflow-y-auto pr-1">
                  {teams.map((t) => {
                    const isPaid = !!paidTeams[t.id];
                    return (
                      <button
                        key={t.id}
                        onClick={() => {
                          setLoginTargetTeam(t);
                          setLoginStep('pin');
                          setLoginError('');
                        }}
                        className={`flex items-center justify-between p-3 rounded-xl border text-left transition ${t.id === userTeamId ? 'bg-blue-600/20 border-blue-500 text-white font-bold' : 'bg-slate-950/50 border-slate-800/80 hover:bg-slate-800/50 text-slate-300'}`}
                      >
                        <div className="flex flex-col">
                          <span className="font-bold">{t.name}</span>
                          <span className="text-[10px] text-slate-500">{t.owner}</span>
                        </div>
                        <div className="flex items-center gap-2">
                          {isPaid ? (
                            <span className="flex items-center gap-1 text-[10px] font-bold bg-emerald-950/80 text-emerald-400 border border-emerald-500/30 px-2 py-0.5 rounded-full">
                              <CheckCircle2 className="w-3 h-3" /> Paid
                            </span>
                          ) : (
                            <span className="flex items-center gap-1 text-[10px] font-bold bg-amber-950/80 text-amber-400 border border-amber-500/30 px-2 py-0.5 rounded-full animate-pulse">
                              <AlertTriangle className="w-3 h-3" /> Unpaid
                            </span>
                          )}
                          {t.id === userTeamId && <span className="text-xs bg-blue-600 px-2 py-0.5 rounded text-white font-bold">Active</span>}
                        </div>
                      </button>
                    );
                  })}
                </div>
              </>
            ) : !isTargetPaid && !isCommissioner ? (
              // --- DUES LOCKOUT SCREEN ---
              <div className="text-center py-6 px-2">
                <div className="inline-flex p-3 bg-amber-500/10 border border-amber-500/30 rounded-full text-amber-400 mb-3">
                  <DollarSign className="w-8 h-8 animate-bounce" />
                </div>
                <h4 className="text-base font-black text-white mb-1">Dues Verification Required</h4>
                <p className="text-xs text-slate-400 max-w-xs mx-auto mb-5 leading-relaxed">
                  The <strong className="text-white">${BUY_IN_AMOUNT} league buy-in</strong> has not been verified for <strong className="text-blue-400">{loginTargetTeam?.name}</strong>. Pay the Commissioner to unlock your PIN and draft permissions!
                </p>
                <div className="bg-slate-950 border border-slate-800 rounded-xl p-3 mb-5 text-left">
                  <div className="text-[10px] font-bold uppercase text-slate-500 mb-1">League Entry Fee</div>
                  <div className="text-lg font-black text-emerald-400">${BUY_IN_AMOUNT}.00</div>
                </div>
                <button onClick={() => { setLoginStep('select'); setLoginError(''); setLoginPin(''); }} className="w-full py-2.5 bg-slate-800 hover:bg-slate-700 text-xs font-bold rounded-xl transition text-white">
                  Back to Team Selection
                </button>
              </div>
            ) : (
              // --- PIN LOGIN SCREEN ---
              <div className="text-center py-4">
                <p className="text-sm font-semibold text-white mb-1">
                  {teamPins[loginTargetTeam!.id] ? 'Enter your 4-digit PIN to login' : 'Create a 4-digit PIN to claim this team'}
                </p>

                <input
                  type="password"
                  pattern="\d*"
                  placeholder="PIN"
                  value={loginPin}
                  onChange={(e) => setLoginPin(e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && handlePinSubmit()}
                  className="w-full max-w-[200px] mx-auto bg-slate-950 border border-slate-700 text-white text-center text-xl font-mono tracking-widest py-3 rounded-xl outline-none focus:border-blue-500 mb-2 block"
                />

                {loginError && <p className="text-xs text-red-500 font-semibold mb-3">{loginError}</p>}

                <div className="flex gap-2 mt-4 max-w-[250px] mx-auto">
                  <button onClick={() => { setLoginStep('select'); setLoginError(''); setLoginPin(''); }} className="flex-1 py-2 bg-slate-800 hover:bg-slate-700 text-xs font-bold rounded-xl transition text-white">Back</button>
                  <button onClick={handlePinSubmit} className="flex-1 py-2 bg-blue-600 hover:bg-blue-500 text-xs font-bold rounded-xl transition text-white">
                    {teamPins[loginTargetTeam!.id] ? 'Login' : 'Claim Team'}
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    );
  };

  const renderCommishAuthModal = () => {
    if (!showCommishPinModal) return null;
    return (
      <div className="fixed inset-0 z-50 bg-slate-950/90 backdrop-blur-sm flex items-center justify-center p-4">
        <div className="bg-slate-900 border border-slate-700 rounded-2xl w-full max-w-sm shadow-2xl overflow-hidden p-6 text-center">
          <div className="inline-flex p-3 bg-blue-600/10 border border-blue-500/20 rounded-full text-blue-400 mb-4">
            <ShieldAlert className="w-8 h-8" />
          </div>
          <h3 className="font-extrabold text-lg text-white mb-1">Commissioner Access</h3>

          <input
            type="password"
            placeholder="Enter Passcode"
            value={inputPin}
            onChange={(e) => setInputPin(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && handleCommishAuth()}
            className="w-full bg-slate-950 border border-slate-700 text-white text-center text-lg font-mono tracking-widest py-2 rounded-xl outline-none focus:border-blue-500 mb-2"
          />

          {pinError && <p className="text-xs text-red-500 font-semibold mb-3">{pinError}</p>}

          <div className="flex gap-2 mt-2">
            <button onClick={closeCommishPinModal} className="flex-1 py-2 bg-slate-800 hover:bg-slate-700 text-xs font-bold rounded-xl transition text-white">Cancel</button>
            <button onClick={handleCommishAuth} className="flex-1 py-2 bg-blue-600 hover:bg-blue-500 text-xs font-bold rounded-xl transition text-white">Unlock</button>
          </div>
        </div>
      </div>
    );
  };

  // --- LOCK SCREEN RENDER ---
  if (!isUnlocked) {
    return (
      <div className="min-h-screen bg-slate-950 text-slate-100 flex flex-col items-center justify-center p-6 relative">
        <div className="z-10 max-w-xl w-full bg-slate-900 border border-slate-800 rounded-2xl p-8 text-center shadow-2xl flex flex-col items-center">
          <div className="inline-flex p-4 bg-blue-600/10 border border-blue-500/20 rounded-full text-blue-400 mb-6">
            <Lock className="w-10 h-10" />
          </div>
          <h1 className="text-3xl font-bold text-white mb-2">Fantasy League Draft Room</h1>

          <div className="grid grid-cols-4 gap-3 mb-6 mt-6 w-full max-w-sm">
            {[{ l: 'Days', v: timeLeft.days }, { l: 'Hours', v: timeLeft.hours }, { l: 'Mins', v: timeLeft.minutes }, { l: 'Secs', v: timeLeft.seconds }].map((item, idx) => (
              <div key={idx} className="bg-slate-800 border border-slate-700 rounded-xl p-3 text-center">
                <span className="block text-3xl font-extrabold text-blue-400">{item.v}</span>
                <span className="text-xs text-slate-400 uppercase">{item.l}</span>
              </div>
            ))}
          </div>

          {/* PRIZE POT PROGRESS METER */}
          <div className="w-full max-w-sm bg-slate-950 border border-slate-800 rounded-xl p-3.5 mb-6 text-left">
            <div className="flex justify-between items-center mb-1.5">
              <span className="text-xs font-bold text-slate-400 flex items-center gap-1.5 uppercase tracking-wider">
                <DollarSign className="w-3.5 h-3.5 text-emerald-400" /> Prize Pot Collected
              </span>
              <span className="text-xs font-black text-emerald-400">${totalPot} / ${maxPot}</span>
            </div>
            <div className="w-full bg-slate-800 rounded-full h-2.5 overflow-hidden">
              <div
                className="bg-emerald-500 h-full rounded-full transition-all duration-500"
                style={{ width: `${Math.min(100, (totalPot / (maxPot || 1)) * 100)}%` }}
              />
            </div>
            <div className="flex justify-between text-[10px] text-slate-500 mt-1 font-semibold">
              <span>{paidCount} of {teams.length} Teams Paid</span>
              <span>${BUY_IN_AMOUNT} Buy-in</span>
            </div>
          </div>

          <div className="w-full max-w-sm border-t border-slate-800 pt-6 flex flex-col gap-3">
            <button onClick={() => setShowLoginModal(true)} className="w-full flex items-center justify-center gap-2 px-6 py-3 bg-blue-600 hover:bg-blue-500 text-white font-bold rounded-xl transition shadow-lg shadow-blue-900/20">
              <UserCheck className="w-5 h-5" /> Team Manager Check-In
            </button>
            <button onClick={() => setShowBylawsModal(true)} className="w-full flex items-center justify-center gap-2 px-6 py-3 bg-slate-800 hover:bg-slate-700 text-slate-300 font-semibold rounded-xl transition text-xs">
              <BookOpen className="w-4 h-4" /> View League Bylaws
            </button>
            <button onClick={() => setShowCommishPinModal(true)} className="w-full flex items-center justify-center gap-2 px-6 py-3 bg-slate-800 hover:bg-slate-700 text-slate-300 font-semibold rounded-xl transition text-xs">
              <KeyRound className="w-4 h-4" /> Commissioner Override
            </button>
          </div>
        </div>

        {renderCommishAuthModal()}
        {renderLoginModal()}
        {renderBylawsModal()}
      </div>
    );
  }

  // --- MAIN APP RENDER ---
  return (
    <div className="min-h-screen bg-slate-950 text-slate-100 flex flex-col overflow-x-hidden">

      {/* --- RESPONSIVE MOBILE & DESKTOP HEADER --- */}
      <header className="bg-slate-900 border-b border-slate-800 px-2 sm:px-4 py-2 sm:py-3 sticky top-0 z-50">
        <div className="w-full mx-auto flex flex-col lg:flex-row lg:items-center justify-between gap-3 lg:gap-4 relative">

          {/* Top row for mobile: Title & Icons */}
          <div className="flex items-center justify-between w-full lg:w-auto">
            <div className="flex items-center gap-2 sm:gap-3">
              <div className="p-1.5 sm:p-2 bg-blue-600 rounded-lg text-white"><Trophy className="w-5 h-5 sm:w-6 sm:h-6" /></div>
              <div>
                <div className="flex items-center gap-2">
                  <h1 className="text-lg sm:text-xl font-black text-white leading-none">JM's FFL</h1>
                  <span className="hidden sm:flex items-center gap-1 text-[10px] bg-emerald-500/10 text-emerald-400 border border-emerald-500/20 px-2 py-0.5 rounded-full font-bold">
                    <Wifi className="w-3 h-3 animate-pulse" /> Live
                  </span>
                </div>
                <p className="text-[10px] sm:text-xs text-slate-400 font-medium">{teams.length}-Team Draft</p>
              </div>
            </div>

            {/* Quick Actions for Mobile */}
            <div className="flex lg:hidden items-center gap-1">
              <button onClick={() => setShowLoginModal(true)} className="p-2 bg-slate-800 hover:bg-slate-700 rounded-lg text-white transition"><UserCheck className="w-4 h-4" /></button>
              <button onClick={() => { setIsPlayersOpen(!isPlayersOpen); setIsChatOpen(false); }} className={`p-2 rounded-lg text-white transition ${isPlayersOpen ? 'bg-blue-600' : 'bg-slate-800 hover:bg-slate-700'}`}><Search className="w-4 h-4" /></button>
              <button onClick={() => { setIsChatOpen(!isChatOpen); setIsPlayersOpen(false); }} className={`p-2 rounded-lg text-white transition ${isChatOpen ? 'bg-emerald-600' : 'bg-slate-800 hover:bg-slate-700'}`}><MessageSquare className="w-4 h-4" /></button>
            </div>
          </div>

          {/* Horizontally Scrollable Tool Bar on Mobile */}
          <div className="flex items-center gap-2 sm:gap-4 overflow-x-auto lg:overflow-visible pb-1 sm:pb-0 scrollbar-hide w-full lg:w-auto">

            {/* --- DESKTOP PANELS & DROPDOWN ANCHOR --- */}
            <div className="relative flex-shrink-0">
              {/* Desktop Buttons */}
              <div className="hidden lg:flex items-center gap-2 bg-slate-950 p-1.5 rounded-xl border border-slate-800">
                <button
                  onClick={() => { setIsPlayersOpen(!isPlayersOpen); setIsChatOpen(false); }}
                  className={`flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-bold transition ${isPlayersOpen ? 'bg-blue-600 text-white' : 'bg-slate-800 hover:bg-slate-700 text-white'}`}
                >
                  <Search className="w-4 h-4 text-blue-400" /> Draft Pool
                </button>
                <button
                  onClick={() => { setIsChatOpen(!isChatOpen); setIsPlayersOpen(false); }}
                  className={`flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-bold transition ${isChatOpen ? 'bg-emerald-600 text-white' : 'bg-slate-800 hover:bg-slate-700 text-white'}`}
                >
                  <MessageSquare className="w-4 h-4 text-emerald-400" /> League Chat
                </button>
              </div>

              {/* --- PLAYERS DROPDOWN / MOBILE DRAWER --- */}
              {isPlayersOpen && (
                <div className="fixed inset-0 z-50 flex justify-start lg:absolute lg:inset-auto lg:top-full lg:left-0 lg:mt-3 lg:w-[420px] lg:h-[75vh] lg:min-h-[500px] lg:max-h-[850px]">
                  <div className="absolute inset-0 bg-slate-950/60 backdrop-blur-sm lg:hidden" onClick={() => setIsPlayersOpen(false)} />
                  <div className="relative w-full max-w-md lg:w-full lg:max-w-none bg-slate-900 border-r lg:border border-slate-700 lg:rounded-2xl shadow-2xl lg:shadow-[0_20px_60px_rgba(0,0,0,0.8)] overflow-hidden flex flex-col h-full animate-in slide-in-from-left lg:slide-in-from-top-2 lg:fade-in duration-200">
                    <div className="p-4 border-b border-slate-800 bg-slate-950 flex justify-between items-center lg:rounded-t-2xl">
                      <h2 className="font-bold text-base flex items-center gap-2"><Users className="w-5 h-5 text-blue-400" /> Available Players</h2>
                      <button onClick={() => setIsPlayersOpen(false)} className="p-1.5 hover:bg-slate-800 rounded-lg text-slate-400 hover:text-white transition">
                        <X className="w-5 h-5" />
                      </button>
                    </div>

                    <div className="p-4 border-b border-slate-800 space-y-3 bg-slate-900">
                      <div className="relative">
                        <Search className="w-4 h-4 absolute left-3 top-2.5 text-slate-500" />
                        <input type="text" placeholder="Search player..." value={searchQuery} onChange={(e) => setSearchQuery(e.target.value)} className="w-full bg-slate-950 border border-slate-800 rounded-xl pl-9 pr-3 py-2 text-sm text-white focus:border-blue-500 outline-none" />
                      </div>

                      <div className="flex items-center gap-2 bg-slate-950 px-3 py-2 rounded-xl border border-slate-800 overflow-x-auto">
                        <span className="text-[9px] uppercase font-black text-slate-500 whitespace-nowrap">Last 10 Picks:</span>
                        {Object.keys(recentPositions).length === 0 ? (
                          <span className="text-[10px] text-slate-600 font-bold italic">No picks yet</span>
                        ) : (
                          ['QB', 'RB', 'WR', 'TE', 'K', 'DEF'].map(pos => {
                            const count = recentPositions[pos];
                            if (!count) return null;
                            return (
                              <span key={pos} className={`px-1.5 py-0.5 rounded text-[9px] font-bold ${count >= 3 ? 'bg-red-500/20 text-red-400 border border-red-500/30' : 'bg-slate-800 text-slate-300'}`}>
                                {count} {pos}
                              </span>
                            )
                          })
                        )}
                      </div>

                      <div className="flex gap-1 overflow-x-auto pb-1">
                        {['ALL', 'QB', 'RB', 'WR', 'TE', 'K', 'DEF'].map((pos) => (
                          <button key={pos} onClick={() => setSelectedPos(pos)} className={`px-3 py-1 rounded-lg text-xs font-bold ${selectedPos === pos ? 'bg-blue-600 text-white' : 'bg-slate-800 text-slate-400'}`}>{pos}</button>
                        ))}
                      </div>
                    </div>

                    <div className="flex-1 overflow-y-auto divide-y divide-slate-800/50 p-2 bg-slate-900">
                      {availablePlayers.map((player) => (
                        <div key={player.id} className="flex items-center justify-between p-2.5 hover:bg-slate-800/50 rounded-xl group">
                          <div className="flex items-center gap-3">
                            <span className={`px-2 py-1 rounded-md font-bold text-xs ${POSITION_COLORS[player.position]?.badge}`}>{player.position}</span>
                            <div>
                              <div className="font-bold text-sm text-white flex items-center gap-1.5">
                                {player.name}
                                {player.injury_status && (
                                  <span className={`px-1 py-[1px] rounded-[4px] text-[8px] font-black uppercase leading-none border ${['Out', 'IR', 'PUP', 'Sus', 'Suspended'].includes(player.injury_status) ? 'bg-red-950/80 text-red-500 border-red-500/50' :
                                    player.injury_status === 'Doubtful' ? 'bg-orange-950/80 text-orange-500 border-orange-500/50' :
                                      'bg-amber-950/80 text-amber-500 border-amber-500/50'
                                    }`}>
                                    {player.injury_status === 'Questionable' ? 'Q' : player.injury_status === 'Doubtful' ? 'D' : player.injury_status === 'Suspended' ? 'SUS' : player.injury_status}
                                  </span>
                                )}
                              </div>
                              <div className="text-xs text-slate-400 font-bold uppercase flex items-center gap-1.5 mt-0.5">
                                {player.team}
                                {player.bye && <span className="text-[8px] bg-slate-800/80 px-1 py-[1px] rounded">BYE {player.bye}</span>}
                              </div>
                            </div>
                          </div>
                          <div className="flex items-center gap-2">
                            {isCommissioner && showCommishTools && (
                              <button
                                onClick={() => {
                                  const firstPick = picks.find(p => p.teamId === (teams[0]?.id || 1));
                                  setAssignModal({ isOpen: true, player, teamId: teams[0]?.id || 1, pickNumber: firstPick?.pickNumber || 1, isKeeper: false });
                                }}
                                className="px-2 py-1.5 rounded-lg text-[10px] font-bold bg-amber-600/20 text-amber-500 border border-amber-500/30 hover:bg-amber-600 hover:text-white transition uppercase"
                              >
                                Assign
                              </button>
                            )}
                            <button
                              onClick={() => handleSelectPlayer(player)}
                              disabled={!isDraftActive || (!isCommissioner && !isMyTurnOrSkipped)}
                              className={`px-3 py-1.5 rounded-lg text-xs font-bold ${!isDraftActive || (!isCommissioner && !isMyTurnOrSkipped) ? 'bg-slate-800 text-slate-600' : 'bg-blue-600 text-white'}`}
                            >
                              Draft
                            </button>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                </div>
              )}

              {/* --- CHAT DROPDOWN / MOBILE DRAWER --- */}
              {isChatOpen && (
                <div className="fixed inset-0 z-50 flex justify-end lg:absolute lg:inset-auto lg:top-full lg:left-0 lg:mt-3 lg:w-[400px] lg:h-[70vh] lg:min-h-[500px] lg:max-h-[800px]">
                  <div className="absolute inset-0 bg-slate-950/60 backdrop-blur-sm lg:hidden" onClick={() => setIsChatOpen(false)} />
                  <div className="relative w-full max-w-md lg:w-full lg:max-w-none bg-slate-900 border-l lg:border border-slate-700 lg:rounded-2xl shadow-2xl lg:shadow-[0_20px_60px_rgba(0,0,0,0.8)] overflow-hidden flex flex-col h-full animate-in slide-in-from-right lg:slide-in-from-top-2 lg:fade-in duration-200">
                    <div className="p-4 border-b border-slate-800 bg-slate-950 flex justify-between items-center lg:rounded-t-2xl">
                      <h2 className="font-bold text-base flex items-center gap-2"><MessageSquare className="w-5 h-5 text-blue-400" /> Live Draft Chat</h2>
                      <button onClick={() => setIsChatOpen(false)} className="p-1.5 hover:bg-slate-800 rounded-lg text-slate-400 hover:text-white transition">
                        <X className="w-5 h-5" />
                      </button>
                    </div>

                    <div className="flex-1 overflow-y-auto p-4 space-y-4 bg-slate-900">
                      {messages.length === 0 ? (
                        <div className="flex items-center justify-center h-full text-sm text-slate-500 italic">No messages yet. Start the trash talk!</div>
                      ) : (
                        messages.map(msg => {
                          const isMe = msg.teamId === userTeamId;
                          const senderTeamName = teams.find(t => t.id === msg.teamId)?.name || 'Unknown Team';
                          return (
                            <div key={msg.id} className={`flex flex-col ${isMe ? 'items-end' : 'items-start'}`}>
                              <span className="text-[10px] text-slate-500 mb-1">{senderTeamName}</span>
                              <div className={`px-4 py-2.5 text-sm max-w-[85%] ${isMe ? 'bg-blue-600 text-white rounded-2xl rounded-tr-sm' : 'bg-slate-800 text-slate-200 rounded-2xl rounded-tl-sm'}`}>
                                {msg.text}
                              </div>
                            </div>
                          );
                        })
                      )}
                      <div ref={chatEndRef} />
                    </div>

                    <form onSubmit={handleSendMessage} className="p-3 border-t border-slate-800 bg-slate-950 flex gap-2 lg:rounded-b-2xl">
                      <input
                        type="text"
                        value={newMessage}
                        onChange={(e) => setNewMessage(e.target.value)}
                        placeholder={userTeamId === null ? "Log in to chat..." : "Message the league..."}
                        disabled={userTeamId === null}
                        className="flex-1 bg-slate-900 border border-slate-800 rounded-xl px-4 py-3 text-sm text-white outline-none focus:border-blue-500 disabled:opacity-50"
                      />
                      <button type="submit" disabled={!newMessage.trim() || userTeamId === null} className="bg-blue-600 hover:bg-blue-500 disabled:opacity-50 disabled:cursor-not-allowed text-white px-4 py-3 rounded-xl transition flex items-center justify-center">
                        <Send className="w-5 h-5" />
                      </button>
                    </form>
                  </div>
                </div>
              )}
            </div>

            {/* PANIC CLOCK UI */}
            <div className={`flex items-center gap-3 sm:gap-6 rounded-xl px-3 py-1.5 sm:px-4 sm:py-2 border transition-all flex-shrink-0 ${clockTime <= 10 && isDraftActive ? 'bg-red-950 border-red-500 shadow-[0_0_15px_rgba(239,68,68,0.4)]' : 'bg-slate-950 border-slate-800'}`}>
              <div className="flex items-center gap-1.5 sm:gap-2">
                <Clock className={`w-4 h-4 sm:w-5 sm:h-5 ${clockTime <= 10 && isDraftActive ? 'text-red-500 animate-pulse' : 'text-blue-400'}`} />
                <span className={`text-xl sm:text-2xl font-mono font-bold ${clockTime <= 10 && isDraftActive ? 'text-red-500' : 'text-white'}`}>
                  {Math.floor(clockTime / 60)}:{(clockTime % 60).toString().padStart(2, '0')}
                </span>
              </div>
              <div className={`h-6 sm:h-8 w-[1px] ${clockTime <= 10 && isDraftActive ? 'bg-red-500/30' : 'bg-slate-800'}`} />
              <div className="text-left">
                <div className="text-[8px] sm:text-[10px] text-slate-400 uppercase font-bold leading-none mb-0.5">On The Clock</div>
                <div className={`text-[10px] sm:text-sm font-bold truncate max-w-[120px] sm:max-w-[200px] leading-tight ${clockTime <= 10 && isDraftActive ? 'text-red-400' : 'text-blue-400'}`}>
                  {currentPick ? `${currentPick.pickNumber} (${currentPickingTeam?.name})` : 'Draft Complete!'}
                </div>
              </div>
            </div>

            {/* Admin/Commish controls */}
            <div className="flex items-center gap-1.5 sm:gap-3 flex-shrink-0">
              {isCommissioner && (
                <button onClick={toggleDraftStatus} className={`flex items-center gap-1.5 px-3 py-1.5 sm:px-4 sm:py-2 rounded-lg font-semibold text-xs sm:text-sm transition ${isDraftActive ? 'bg-amber-600/20 text-amber-300 border border-amber-500' : 'bg-emerald-600 text-white'}`}>
                  {isDraftActive ? <Pause className="w-3.5 h-3.5" /> : <Play className="w-3.5 h-3.5" />} {isDraftActive ? 'Pause' : 'Start'}
                </button>
              )}
              <button onClick={handleDownloadBoard} className="p-1.5 sm:p-2 rounded-lg bg-slate-800 text-slate-300 hover:text-white transition"><Camera className="w-4 h-4 sm:w-5 sm:h-5" /></button>
              <button onClick={toggleMute} className="p-1.5 sm:p-2 rounded-lg bg-slate-800 text-slate-300 hover:text-white transition">{isMuted ? <VolumeX className="w-4 h-4 sm:w-5 sm:h-5" /> : <Volume2 className="w-4 h-4 sm:w-5 sm:h-5" />}</button>
              <button onClick={toggleCommishPanel} className="p-1.5 sm:p-2 rounded-lg bg-slate-800 text-slate-300 hover:text-white transition"><Settings className="w-4 h-4 sm:w-5 sm:h-5" /></button>
              <button onClick={() => setShowLoginModal(true)} className="hidden lg:block p-1.5 sm:p-2 rounded-lg bg-slate-800 text-slate-300 hover:text-white transition"><UserCheck className="w-4 h-4 sm:w-5 sm:h-5" /></button>
            </div>
          </div>
        </div>
      </header>

      {renderCommishAuthModal()}
      {renderLoginModal()}
      {renderBylawsModal()}

      {/* Manual Assignment Modal */}
      {assignModal.isOpen && assignModal.player && (
        <div className="fixed inset-0 z-50 bg-slate-950/80 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-slate-900 border border-amber-500/30 rounded-xl w-full max-w-sm shadow-2xl overflow-hidden">
            <div className="bg-amber-600/20 p-4 border-b border-amber-500/30">
              <h3 className="font-black text-amber-400 text-lg">Manual Assignment</h3>
              <p className="text-xs text-amber-200/60 mt-1">Force assign {assignModal.player.name} to a specific pick. This will overwrite any existing player.</p>
            </div>
            <div className="p-5 space-y-4">
              <div>
                <label className="block text-xs uppercase font-bold text-slate-500 mb-1">Target Team</label>
                <select
                  value={assignModal.teamId}
                  onChange={(e) => {
                    const newTeamId = Number(e.target.value);
                    const firstPick = picks.find(p => p.teamId === newTeamId);
                    setAssignModal({ ...assignModal, teamId: newTeamId, pickNumber: firstPick?.pickNumber || 1 });
                  }}
                  className="w-full bg-slate-950 border border-slate-700 text-white text-sm py-2 px-3 rounded-lg outline-none"
                >
                  {teams.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}
                </select>
              </div>
              <div>
                <label className="block text-xs uppercase font-bold text-slate-500 mb-1">Target Pick</label>
                <select
                  value={assignModal.pickNumber}
                  onChange={(e) => setAssignModal({ ...assignModal, pickNumber: Number(e.target.value) })}
                  className="w-full bg-slate-950 border border-slate-700 text-white text-sm py-2 px-3 rounded-lg outline-none"
                >
                  {picks.filter(p => p.teamId === assignModal.teamId).map(p => (
                    <option key={p.pickNumber} value={p.pickNumber}>
                      Round {p.round} (Overall #{p.pickNumber}) {p.player ? `- Overwrite ${p.player.name}` : '- Empty'}
                    </option>
                  ))}
                </select>
              </div>
              <label className="flex items-center gap-2 mt-2 cursor-pointer border-t border-slate-800 pt-4">
                <input type="checkbox" checked={assignModal.isKeeper} onChange={(e) => setAssignModal({ ...assignModal, isKeeper: e.target.checked })} className="w-4 h-4 rounded border-slate-700 bg-slate-950 text-amber-500" />
                <span className="text-xs font-bold text-slate-300">Mark as Keeper (adds yellow 'K' badge)</span>
              </label>
            </div>
            <div className="flex gap-2 p-4 bg-slate-950/50 border-t border-slate-800">
              <button onClick={() => setAssignModal({ ...assignModal, isOpen: false })} className="flex-1 px-4 py-2 bg-slate-800 hover:bg-slate-700 text-white font-bold text-sm rounded-lg transition">Cancel</button>
              <button onClick={handleSaveAssignment} className="flex-1 px-4 py-2 bg-amber-600 hover:bg-amber-500 text-white font-bold text-sm rounded-lg transition">Force Assign</button>
            </div>
          </div>
        </div>
      )}

      {/* Commish Tools & Settings */}
      {isCommissioner && showCommishTools && (
        <div className="bg-slate-900 border-b border-blue-500/30 p-4 sm:p-6 space-y-6 shadow-xl relative z-20">
          <div className="w-full mx-auto grid grid-cols-1 lg:grid-cols-2 gap-8">
            <div className="space-y-4">
              <h3 className="text-sm font-bold text-blue-400 flex items-center gap-2 uppercase"><ShieldAlert className="w-4 h-4" /> Commish Actions</h3>
              <div className="flex flex-wrap items-center gap-2 sm:gap-3">
                <button onClick={handleResetDraft} className="flex items-center gap-1.5 px-3 py-1.5 sm:px-4 sm:py-2 bg-red-600/20 text-red-400 border border-red-500/30 hover:bg-red-600 hover:text-white rounded-lg transition text-xs sm:text-sm font-semibold"><Trash2 className="w-4 h-4" /> Reset Draft</button>
                <button onClick={handleUndoPick} className="flex items-center gap-1.5 px-3 py-1.5 sm:px-4 sm:py-2 bg-slate-800 hover:bg-slate-700 rounded-lg transition text-xs sm:text-sm font-semibold"><RotateCcw className="w-4 h-4 text-amber-400" /> Undo Last Pick</button>
                <button onClick={handleExportCSV} className="flex items-center gap-1.5 px-3 py-1.5 sm:px-4 sm:py-2 bg-blue-600/20 text-blue-400 border border-blue-500/30 hover:bg-blue-600 hover:text-white rounded-lg transition text-xs sm:text-sm font-semibold"><Download className="w-4 h-4" /> Export CSV</button>
              </div>

              {/* LIVE TIMER CONTROLS */}
              <div className="bg-slate-950 p-3 sm:p-4 rounded-xl border border-slate-800">
                <h4 className="text-xs font-bold text-blue-400 uppercase flex items-center gap-2 mb-3"><Clock className="w-3.5 h-3.5" /> Live Timer Controls</h4>
                <div className="flex flex-wrap items-end gap-3 sm:gap-4">
                  <div>
                    <label className="block text-[10px] uppercase font-bold text-slate-500 mb-1">Default (Secs)</label>
                    <input type="number" value={defaultPickTime} onChange={(e) => { const newTime = Number(e.target.value); setDefaultPickTime(newTime); set(ref(db, 'draftState/defaultPickTime'), newTime); }} className="w-16 sm:w-20 bg-slate-900 border border-slate-700 px-2 sm:px-3 py-1.5 rounded-lg text-sm text-white outline-none focus:border-blue-500" />
                  </div>
                  <div className="flex-1">
                    <label className="block text-[10px] uppercase font-bold text-slate-500 mb-1">Adjust Current Clock</label>
                    <div className="flex flex-wrap sm:flex-nowrap items-center gap-2">
                      <button onClick={() => setClockTime(prev => prev + 15)} className="px-3 py-1.5 bg-slate-800 hover:bg-slate-700 text-xs font-bold rounded-lg transition text-slate-300">+15s</button>
                      <button onClick={() => setClockTime(prev => Math.max(0, prev - 15))} className="px-3 py-1.5 bg-slate-800 hover:bg-slate-700 text-xs font-bold rounded-lg transition text-slate-300">-15s</button>
                      <button onClick={() => setClockTime(defaultPickTime)} className="px-3 py-1.5 bg-blue-600/20 text-blue-400 hover:bg-blue-600 hover:text-white border border-blue-500/30 text-xs font-bold rounded-lg transition">Reset Current</button>
                    </div>
                  </div>
                </div>
              </div>

              {/* DUES & PIN MANAGEMENT */}
              <div>
                <div className="flex justify-between items-center mb-2 mt-4">
                  <label className="text-[10px] uppercase font-bold text-slate-500">Team Names, PINs & Dues ($25)</label>
                  <span className="text-[10px] font-black text-emerald-400">${totalPot} / ${maxPot} Collected</span>
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 max-h-48 overflow-y-auto pr-2">
                  {tempTeams.map((team, idx) => {
                    const isPaid = !!paidTeams[team.id];
                    return (
                      <div key={team.id} className="flex flex-col gap-1.5 bg-slate-950 p-2.5 rounded-lg border border-slate-800">
                        <div className="flex items-center justify-between">
                          <span className="text-[10px] font-bold text-slate-500">{idx + 1}.</span>
                          <div className="flex items-center gap-1.5">
                            <button onClick={() => togglePaidStatus(team.id)} className={`text-[9px] font-black px-2 py-0.5 rounded transition ${isPaid ? 'bg-emerald-600 text-white hover:bg-emerald-500' : 'bg-amber-500/20 text-amber-400 border border-amber-500/30 hover:bg-amber-500 hover:text-white'}`}>
                              {isPaid ? '$25 Paid ✅' : 'Unpaid ❌'}
                            </button>
                            {teamPins[team.id] ? <button onClick={() => set(ref(db, `draftState/teamPins/${team.id}`), null)} className="text-[9px] text-red-400 hover:text-red-300 font-bold bg-red-950/50 px-1.5 py-0.5 rounded">Reset PIN</button> : null}
                          </div>
                        </div>
                        <input type="text" value={team.name} onChange={(e) => updateTempTeamName(idx, e.target.value)} className="w-full bg-transparent text-xs text-white outline-none border-b border-slate-800 focus:border-blue-500 pb-0.5" />
                      </div>
                    );
                  })}
                </div>
                <button onClick={() => { set(ref(db, 'draftState/teams'), tempTeams); alert("Team names synced to live board!"); }} className="w-full mt-3 bg-blue-600/20 text-blue-400 border border-blue-500/30 hover:bg-blue-600 hover:text-white text-xs font-bold py-2 rounded-lg transition">
                  Quick Save Name Changes (No Reset)
                </button>
              </div>
            </div>

            {/* League Settings & Custom Round Editor */}
            <div className="flex flex-col bg-slate-950 p-4 rounded-xl border border-slate-800">
              <div className="flex items-center justify-between mb-4">
                <h3 className="text-sm font-bold text-blue-400 uppercase flex items-center gap-2"><Settings className="w-4 h-4" /> Board & Order Settings</h3>
                <button onClick={handleApplySettings} className="flex items-center gap-1.5 bg-emerald-600 hover:bg-emerald-500 text-white px-3 py-1.5 rounded-lg text-xs font-bold transition">
                  <Save className="w-3.5 h-3.5" /> Apply & Reset Board
                </button>
              </div>

              <div className="flex flex-col sm:flex-row sm:items-center gap-3 sm:gap-4 mb-6">
                <div className="flex-1">
                  <label className="block text-[10px] uppercase font-bold text-slate-500 mb-1">Number of Teams</label>
                  <input type="number" value={tempTeams.length} onChange={(e) => updateTempTeamCount(Number(e.target.value))} min={2} max={32} className="w-full bg-slate-900 border border-slate-700 rounded-lg px-3 py-2 text-sm text-white outline-none focus:border-blue-500" />
                </div>
                <div className="flex-1">
                  <label className="block text-[10px] uppercase font-bold text-slate-500 mb-1">Total Rounds</label>
                  <input type="number" value={tempRounds} onChange={(e) => handleRoundsChange(Number(e.target.value))} min={1} max={30} className="w-full bg-slate-900 border border-slate-700 rounded-lg px-3 py-2 text-sm text-white outline-none focus:border-blue-500" />
                </div>
              </div>

              {/* Round-by-Round Customizer */}
              <div className="flex-1 border-t border-slate-800 pt-4 flex flex-col">
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 mb-3">
                  <label className="block text-[10px] uppercase font-bold text-slate-500">Round-by-Round Editor</label>
                  <select value={editingRound} onChange={(e) => setEditingRound(Number(e.target.value))} className="bg-slate-900 border border-slate-700 text-white text-xs py-1.5 sm:py-1 px-2 rounded outline-none w-full sm:w-auto">
                    {Array.from({ length: tempRounds }).map((_, i) => (
                      <option key={i} value={i + 1}>Edit Round {i + 1}</option>
                    ))}
                  </select>
                </div>

                <div className="flex items-center gap-2 mb-3">
                  <button onClick={handleCopyPrevRound} disabled={editingRound === 1} className="flex-1 flex justify-center items-center gap-1.5 bg-slate-900 hover:bg-slate-800 border border-slate-700 rounded-md py-1.5 text-xs text-slate-300 disabled:opacity-50 disabled:cursor-not-allowed transition">
                    <Copy className="w-3.5 h-3.5" /> Copy Prev
                  </button>
                  <button onClick={handleReverseCurrentRound} className="flex-1 flex justify-center items-center gap-1.5 bg-slate-900 hover:bg-slate-800 border border-slate-700 rounded-md py-1.5 text-xs text-slate-300 transition">
                    <ArrowRightLeft className="w-3.5 h-3.5" /> Reverse Order
                  </button>
                </div>

                <div className="grid grid-cols-2 md:grid-cols-3 gap-2 overflow-y-auto pr-1">
                  {customOrder[editingRound - 1]?.map((teamId, slotIdx) => (
                    <div key={slotIdx} className="flex flex-col gap-1 bg-slate-900 p-2 rounded-lg border border-slate-800">
                      <span className="text-[9px] font-bold text-slate-500 uppercase">Pick {slotIdx + 1}</span>
                      <select value={teamId} onChange={(e) => updateCustomOrderSlot(editingRound - 1, slotIdx, Number(e.target.value))} className="bg-slate-950 border border-slate-800 text-white text-xs py-1 px-1.5 rounded outline-none w-full">
                        {tempTeams.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}
                      </select>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Main Board - SWIPEABLE ON MOBILE, EDGE TO EDGE ON TV */}
      <div className="flex-1 w-full px-1 sm:px-4 pb-4 pt-1 sm:pt-2 flex flex-col relative h-[calc(100vh-140px)] sm:h-[calc(100vh-110px)] overflow-hidden">

        {/* Roster Modal Overlay */}
        {viewingTeam && (
          <div className="absolute inset-0 z-40 bg-slate-950/80 backdrop-blur-sm flex items-center justify-center p-4 rounded-2xl">
            <div className="bg-slate-900 border border-slate-700 rounded-xl w-full max-w-md shadow-2xl flex flex-col max-h-[90%]">
              <div className="p-4 border-b border-slate-800 flex justify-between items-center bg-slate-950 rounded-t-xl">
                {isEditingName ? (
                  <div className="flex items-center gap-2 flex-1 mr-4">
                    <Users className="w-5 h-5 text-blue-400" />
                    <input type="text" value={editNameValue} onChange={(e) => setEditNameValue(e.target.value)} className="bg-slate-900 border border-slate-700 text-white px-2 py-1 rounded text-sm font-bold outline-none flex-1 focus:border-blue-500" autoFocus onKeyDown={(e) => e.key === 'Enter' && handleSaveTeamName()} />
                    <button onClick={handleSaveTeamName} className="bg-emerald-600 hover:bg-emerald-500 text-white px-2 py-1 rounded text-xs font-bold transition">Save</button>
                    <button onClick={() => setIsEditingName(false)} className="bg-slate-800 hover:bg-slate-700 text-white px-2 py-1 rounded text-xs font-bold transition">Cancel</button>
                  </div>
                ) : (
                  <h3 className="font-black text-lg text-white flex items-center gap-2">
                    <Users className="w-5 h-5 text-blue-400" /> {viewingTeam.name} Roster
                    {(isCommissioner || userTeamId === viewingTeam.id) && (
                      <button onClick={() => setIsEditingName(true)} className="p-1 hover:bg-slate-800 text-slate-500 hover:text-blue-400 rounded transition ml-1" title="Edit Team Name">
                        <Edit2 className="w-3.5 h-3.5" />
                      </button>
                    )}
                  </h3>
                )}
                {!isEditingName && (
                  <button onClick={() => setViewingTeam(null)} className="p-1 hover:bg-slate-800 rounded-lg text-slate-400 hover:text-white transition">
                    <X className="w-5 h-5" />
                  </button>
                )}
              </div>
              <div className="p-3 overflow-y-auto flex-1 space-y-1.5">
                {picks.filter(p => p.teamId === viewingTeam.id).map(pick => {
                  const enriched = getEnrichedPlayer(pick.player);
                  return (
                    <div key={pick.pickNumber} className="flex items-center justify-between p-3 rounded-lg bg-slate-950/50 border border-slate-800/80">
                      <div className="text-xs text-slate-500 font-bold w-10">R{pick.round}</div>
                      {enriched ? (
                        <div className="flex-1 flex justify-between items-center ml-2">
                          <span className="font-bold text-sm text-white flex items-center gap-1.5">
                            {enriched.name}
                            {enriched.injury_status && (
                              <span className={`px-1 py-[1px] rounded-[4px] text-[8px] font-black uppercase leading-none border ${['Out', 'IR', 'PUP', 'Sus', 'Suspended'].includes(enriched.injury_status) ? 'bg-red-950/80 text-red-500 border-red-500/50' :
                                enriched.injury_status === 'Doubtful' ? 'bg-orange-950/80 text-orange-500 border-orange-500/50' :
                                  'bg-amber-950/80 text-amber-500 border-amber-500/50'
                                }`}>
                                {enriched.injury_status === 'Questionable' ? 'Q' : enriched.injury_status === 'Doubtful' ? 'D' : enriched.injury_status === 'Suspended' ? 'SUS' : enriched.injury_status}
                              </span>
                            )}
                            {pick.isKeeper && <span className="text-[10px] bg-amber-500/20 text-amber-500 px-1 py-0.5 rounded border border-amber-500/30">KEEPER</span>}
                          </span>
                          <div className="flex items-center gap-2">
                            <span className="text-xs text-slate-400 font-bold uppercase flex items-center gap-1">
                              {enriched.team}
                              {enriched.bye && <span className="text-[8px] bg-slate-800/80 px-1 py-[1px] rounded">BYE {enriched.bye}</span>}
                            </span>
                            <span className={`px-2 py-0.5 rounded text-[10px] font-bold ${POSITION_COLORS[enriched.position]?.badge}`}>{enriched.position}</span>
                            {isCommissioner && showCommishTools && (
                              <button onClick={() => handleManualRemovePlayer(picks.findIndex(p => p.pickNumber === pick.pickNumber))} className="p-1.5 hover:bg-red-500/20 text-red-500 rounded-md transition ml-1">
                                <Trash2 className="w-3.5 h-3.5" />
                              </button>
                            )}
                          </div>
                        </div>
                      ) : (
                        <div className="flex-1 ml-2 text-sm text-slate-600 font-semibold italic">Empty</div>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          </div>
        )}

        <div className="flex-1 min-w-0 bg-slate-900 border border-slate-800 rounded-xl sm:rounded-2xl p-2 sm:p-4 flex flex-col h-full overflow-hidden shadow-2xl">

          {/* HORIZONTAL SCROLL ENABLED HERE */}
          <div className="flex-1 overflow-x-auto overflow-y-auto">

            {/* THE SQUISH FIX: min-w-full with inline-block enables scroll on mobile but stretches cleanly to edges on TV */}
            <div ref={boardRef} className="inline-block pb-8 min-w-full bg-slate-900 p-1 sm:p-2" style={{ minWidth: `${48 + (teams.length * 110)}px` }}>

              {/* Header Row */}
              <div
                className="grid gap-1.5 sm:gap-2 sticky top-0 bg-slate-900 z-20 pb-2 border-b border-slate-800"
                style={{ gridTemplateColumns: `48px repeat(${teams.length}, 1fr)` }}
              >
                <div className="sticky left-0 bg-slate-900 z-30 flex items-center justify-center border-r border-slate-800/50">
                  <span className="text-[10px] font-bold text-slate-500/50">RND</span>
                </div>

                {teams.map((team) => (
                  <button
                    key={team.id}
                    onClick={() => setViewingTeam(team)}
                    className="bg-slate-950 border border-slate-800 hover:border-blue-500 hover:bg-slate-800 transition rounded-lg p-2 text-center cursor-pointer group min-h-[44px] flex items-center justify-center shadow-sm"
                  >
                    <div className="text-[10px] sm:text-xs font-black text-white group-hover:text-blue-400 leading-tight uppercase line-clamp-2">{team.name}</div>
                  </button>
                ))}
              </div>

              {/* Draft Rounds */}
              <div className="space-y-1.5 sm:space-y-2 mt-2">
                {Array.from({ length: totalRounds }).map((_, rIdx) => {
                  const rNum = rIdx + 1;
                  const roundPicks = picks.filter((p) => p.round === rNum);

                  return (
                    <div
                      key={rNum}
                      className="grid gap-1.5 sm:gap-2 items-stretch relative"
                      style={{ gridTemplateColumns: `48px repeat(${teams.length}, 1fr)` }}
                    >
                      {/* Sticky Round Number Column */}
                      <div className="sticky left-0 z-10 bg-slate-900/90 backdrop-blur-md flex items-center justify-center h-full min-h-[80px] sm:min-h-[90px] border border-slate-800 rounded-lg shadow-[4px_0_15px_-3px_rgba(0,0,0,0.3)]">
                        <span className="text-sm font-black text-slate-400">{rNum}</span>
                      </div>

                      {/* Team Pick Blocks */}
                      {teams.map((team) => {
                        const teamPicksThisRound = roundPicks.filter((p) => p.teamId === team.id);

                        if (teamPicksThisRound.length === 0) {
                          return (
                            <div key={`empty-${team.id}-${rNum}`} className="h-full min-h-[80px] sm:min-h-[90px] bg-slate-900/40 border border-slate-800/30 rounded-lg flex items-center justify-center">
                            </div>
                          );
                        }

                        return (
                          <div key={team.id} className="flex flex-col gap-1.5 sm:gap-2 h-full">
                            {teamPicksThisRound.map((pick) => {
                              const pickIndex = picks.findIndex(p => p.pickNumber === pick.pickNumber);
                              const isCurrent = pickIndex === currentPickIndex;
                              const isSkipped = !pick.player && pickIndex < currentPickIndex;

                              const enriched = getEnrichedPlayer(pick.player);
                              const posStyle = enriched ? POSITION_COLORS[enriched.position] : null;
                              const split = enriched ? getSplitName(enriched.name) : null;

                              return (
                                <div key={pick.pickNumber} className={`h-[80px] sm:h-[90px] rounded-lg p-1.5 sm:p-2 flex flex-col justify-between border relative shadow-sm ${isCurrent ? 'border-amber-400 bg-amber-500/10 ring-2 ring-amber-400/30 animate-pulse' : isSkipped ? 'border-red-500/50 bg-red-950/30 ring-1 ring-red-500/50' : enriched ? `${posStyle?.bg} ${posStyle?.border}` : 'bg-slate-950/50 border-slate-800/80'}`}>
                                  {pick.isKeeper && (
                                    <div className="absolute -top-2 -right-2 bg-amber-500 text-slate-950 text-[9px] sm:text-[10px] font-black w-4 h-4 sm:w-5 sm:h-5 flex items-center justify-center rounded-full shadow-lg">K</div>
                                  )}

                                  {/* Top Bar: Position & NFL Team / Pick # */}
                                  <div className="flex justify-between items-center text-[9px] sm:text-[10px]">
                                    {enriched ? (
                                      <span className={`px-1 sm:px-1.5 py-0.5 rounded font-bold text-[8px] sm:text-[9px] ${posStyle?.badge}`}>{enriched.position}</span>
                                    ) : (
                                      <span className="text-slate-500 font-medium">#{pick.pickNumber}</span>
                                    )}

                                    {enriched && (
                                      <span className="text-white/70 font-bold text-[9px] sm:text-[10px] uppercase">
                                        {enriched.team}
                                      </span>
                                    )}
                                  </div>

                                  {/* First Name stacked over BOLD Last Name */}
                                  {enriched && split ? (
                                    <div className="my-auto text-center leading-none px-0.5">
                                      <div className="text-[9px] sm:text-xs font-semibold text-slate-200 truncate tracking-tight mb-0.5">{split.firstName}</div>
                                      <div className={`text-[11px] sm:text-sm font-black tracking-tight truncate uppercase leading-tight ${posStyle?.text}`}>{split.lastName}</div>
                                    </div>
                                  ) : (
                                    <div className="text-[10px] sm:text-xs text-slate-700 font-semibold text-center my-auto">Empty</div>
                                  )}

                                  {/* Bottom Row - BYE WEEK */}
                                  {enriched && (
                                    <div className="flex justify-between items-center text-[8px] sm:text-[9px] text-white/60 font-medium border-t border-white/10 pt-1 mt-1">
                                      <span>#{pick.pickNumber}</span>
                                      {enriched.bye && (
                                        <span className="text-white font-black bg-black/40 border border-white/10 px-1.5 py-[1px] rounded text-[7px] sm:text-[8px] leading-none">
                                          BYE {enriched.bye}
                                        </span>
                                      )}
                                      <span>R{pick.round}</span>
                                    </div>
                                  )}
                                </div>
                              );
                            })}
                          </div>
                        );
                      })}
                    </div>
                  );
                })}
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}