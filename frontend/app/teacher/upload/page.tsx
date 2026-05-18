'use client';

import { useState, useEffect, useRef, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { coursesAPI, lessonsAPI, accessibilityAPI } from '@/lib/api';
import { useAuth } from '@/lib/auth-context';
import { useAccessibilitySocket } from '@/hooks/use-accessibility-socket';
import { RouteGuard } from '@/lib/route-guard';
import { DashboardLayout } from '@/components/dashboard-layout-new';
import { KeyboardShortcutsHelp } from '@/components/keyboard-shortcuts-help';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { BookOpen, FileVideo, CheckCircle2, AlertCircle, Loader2, PlusCircle, Wand2, Headphones, Mic } from 'lucide-react';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';

type ActiveTab = 'create-course' | 'add-lesson';

export default function UploadPage() {
  const router = useRouter();
  const { user } = useAuth();

  const [activeTab, setActiveTab] = useState<ActiveTab>('create-course');
  const [courses, setCourses] = useState<any[]>([]);
  const [loadingCourses, setLoadingCourses] = useState(true);

  // Course creation form state
  const [courseForm, setCourseForm] = useState({
    title: '',
    description: '',
    category: '',
    difficulty: 'beginner',
  });
  const [courseSubmitting, setCourseSubmitting] = useState(false);
  const [courseSuccess, setCourseSuccess] = useState('');
  const [courseError, setCourseError] = useState('');

  // Lesson creation form state
  const [lessonForm, setLessonForm] = useState({
    courseId: '',
    title: '',
    description: '',
    durationMinutes: 30,
  });
  const [videoFile, setVideoFile] = useState<File | null>(null);
  const [documentFile, setDocumentFile] = useState<File | null>(null);
  const videoInputRef = useRef<HTMLInputElement>(null);
  const documentInputRef = useRef<HTMLInputElement>(null);
  const [lessonSubmitting, setLessonSubmitting] = useState(false);
  const [lessonSuccess, setLessonSuccess] = useState('');
  const [lessonError, setLessonError] = useState('');

  // AI accessibility state — tracks the most recently created lesson and any running jobs
  const [createdLesson, setCreatedLesson] = useState<any>(null);
  const [aiJob, setAiJob] = useState<{
    stt: { jobId: string | null; status: string; progress: string; submitting: boolean; error: string };
    tts: { jobId: string | null; status: string; progress: string; submitting: boolean; error: string };
  }>({
    stt: { jobId: null, status: '', progress: '', submitting: false, error: '' },
    tts: { jobId: null, status: '', progress: '', submitting: false, error: '' },
  });

  // WebSocket: receive job completion events instead of polling
  const handleJobDone = useCallback((payload: { jobId: string; jobType: 'stt' | 'tts'; status: string; url?: string; error?: string }) => {
    setAiJob((prev) => ({
      ...prev,
      [payload.jobType]: {
        ...prev[payload.jobType],
        status: payload.status,
        progress: payload.status === 'completed' ? '100%' : '',
        submitting: false,
        error: payload.error || '',
      },
    }));
  }, []);

  useAccessibilitySocket(user?.id, handleJobDone);

  useEffect(() => {
    fetchTeacherCourses();
  }, []);

  const fetchTeacherCourses = async () => {
    try {
      setLoadingCourses(true);
      const data = await coursesAPI.getTeacherCourses();
      setCourses(data as any[]);
    } catch (err: any) {
      console.error('Failed to fetch courses:', err);
    } finally {
      setLoadingCourses(false);
    }
  };

  // --- Course form handlers ---
  const handleCourseChange = (field: string, value: string) => {
    setCourseForm(prev => ({ ...prev, [field]: value }));
  };

  const handleCourseSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setCourseError('');
    setCourseSuccess('');

    if (!courseForm.title.trim()) {
      setCourseError('Course title is required.');
      return;
    }
    if (!courseForm.description.trim()) {
      setCourseError('Course description is required.');
      return;
    }
    if (!courseForm.category) {
      setCourseError('Please select a category.');
      return;
    }

    try {
      setCourseSubmitting(true);
      await coursesAPI.create({
        title: courseForm.title.trim(),
        description: courseForm.description.trim(),
        category: courseForm.category,
        difficultyLevel: courseForm.difficulty,
        teacherId: user?.id,
      });

      setCourseSuccess('Course created successfully!');
      setCourseForm({ title: '', description: '', category: '', difficulty: 'beginner' });
      await fetchTeacherCourses();
      setTimeout(() => setCourseSuccess(''), 4000);
    } catch (err: any) {
      setCourseError(err.message || 'Failed to create course. Please try again.');
    } finally {
      setCourseSubmitting(false);
    }
  };

  // --- Lesson form handlers ---
  const handleLessonChange = (field: string, value: any) => {
    setLessonForm(prev => ({ ...prev, [field]: value }));
  };

  const handleVideoChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0] ?? null;
    setVideoFile(file);
  };

  const handleDocumentChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0] ?? null;
    setDocumentFile(file);
  };

  // Submit an AI job and update local state (manual retry or initial auto-submit)
  const handleGenerateAI = async (jobType: 'stt' | 'tts', lessonOverride?: any) => {
    const lesson = lessonOverride ?? createdLesson;
    if (!lesson) return;
    setAiJob((prev) => ({
      ...prev,
      [jobType]: { jobId: null, status: 'queued', progress: '', submitting: true, error: '' },
    }));
    try {
      const data: any = await accessibilityAPI.submitJob(lesson.id, jobType);
      setAiJob((prev) => ({
        ...prev,
        [jobType]: { jobId: data.job_id, status: data.status, progress: '', submitting: false, error: '' },
      }));
    } catch (err: any) {
      setAiJob((prev) => ({
        ...prev,
        [jobType]: { jobId: null, status: 'failed', progress: '', submitting: false, error: err.message || 'Failed to submit job' },
      }));
    }
  };

  const handleLessonSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLessonError('');
    setLessonSuccess('');

    if (!lessonForm.courseId) {
      setLessonError('Please select a course for this lesson.');
      return;
    }
    if (!lessonForm.title.trim()) {
      setLessonError('Lesson title is required.');
      return;
    }
    if (!videoFile && !documentFile) {
      setLessonError('Please select either a video or document file to upload.');
      return;
    }

    try {
      setLessonSubmitting(true);
      const existingLessons = await lessonsAPI.getByCourse(parseInt(lessonForm.courseId)) as any[];
      const orderIndex = existingLessons.length + 1;

      const newLesson: any = await lessonsAPI.create({
        courseId: parseInt(lessonForm.courseId),
        title: lessonForm.title.trim(),
        description: lessonForm.description.trim() || undefined,
        videoFile,
        documentFile,
        orderIndex,
        durationMinutes: lessonForm.durationMinutes,
      });

      setCreatedLesson(newLesson);
      setAiJob({
        stt: { jobId: null, status: '', progress: '', submitting: false, error: '' },
        tts: { jobId: null, status: '', progress: '', submitting: false, error: '' },
      });
      setLessonSuccess('Lesson added! AI accessibility jobs are starting automatically…');

      // Auto-submit AI jobs for whichever files were uploaded
      if (newLesson.video_url) handleGenerateAI('stt', newLesson);
      if (newLesson.document_url) handleGenerateAI('tts', newLesson);
      setLessonForm(prev => ({ ...prev, title: '', description: '', durationMinutes: 30 }));
      setVideoFile(null);
      setDocumentFile(null);
      if (videoInputRef.current) videoInputRef.current.value = '';
      if (documentInputRef.current) documentInputRef.current.value = '';
      setTimeout(() => setLessonSuccess(''), 4000);
    } catch (err: any) {
      setLessonError(err.message || 'Failed to add lesson. Please try again.');
    } finally {
      setLessonSubmitting(false);
    }
  };

  // Keyboard shortcuts
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.ctrlKey) {
        switch (e.key.toLowerCase()) {
          case 'h':
            e.preventDefault();
            router.push('/teacher/dashboard');
            break;
          case 'c':
            e.preventDefault();
            router.push('/teacher/courses');
            break;
          case 'a':
            e.preventDefault();
            router.push('/teacher/accessibility');
            break;
          case 's':
            e.preventDefault();
            document.querySelector<HTMLFormElement>('form')?.requestSubmit();
            break;
        }
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [router]);

  const keyboardShortcuts = [
    { keys: ['Ctrl', 'H'], description: 'Go to Dashboard' },
    { keys: ['Ctrl', 'C'], description: 'Go to Courses' },
    { keys: ['Ctrl', 'A'], description: 'Go to Accessibility' },
    { keys: ['Ctrl', 'S'], description: 'Submit active form' },
  ];

  return (
    <RouteGuard allowedRoles={['teacher']}>
      <DashboardLayout role="teacher" userName={user?.full_name || 'Teacher'} userRole="Teacher">
        <KeyboardShortcutsHelp shortcuts={keyboardShortcuts} />
        <div className="space-y-8">
          {/* Header */}
          <div>
            <h1 className="text-3xl font-bold text-gray-900">Course & Lesson Upload</h1>
            <p className="text-gray-600 mt-2">Create a new course or add lessons to an existing one</p>
          </div>

          {/* Tab switcher */}
          <div>
            <div className="flex gap-2 border-b border-gray-200 bg-white rounded-t-lg px-4 w-fit" role="tablist">
                  <button
                    type="button"
                    role="tab"
                    aria-selected={activeTab === 'create-course'}
                    data-testid="tab-create-course"
                    onClick={() => setActiveTab('create-course')}
                    className={`flex items-center gap-2 px-6 py-3 text-sm font-medium border-b-2 transition-colors ${
                      activeTab === 'create-course'
                        ? 'border-blue-600 text-blue-600'
                        : 'border-transparent text-gray-500 hover:text-gray-700'
                    }`}
                  >
                    <BookOpen className="h-4 w-4" aria-hidden="true" />
                    Create Course
                  </button>
                  <button
                    type="button"
                    role="tab"
                    aria-selected={activeTab === 'add-lesson'}
                    data-testid="tab-add-lesson"
                    onClick={() => setActiveTab('add-lesson')}
                    className={`flex items-center gap-2 px-6 py-3 text-sm font-medium border-b-2 transition-colors ${
                      activeTab === 'add-lesson'
                        ? 'border-blue-600 text-blue-600'
                        : 'border-transparent text-gray-500 hover:text-gray-700'
                    }`}
                  >
                    <FileVideo className="h-4 w-4" aria-hidden="true" />
                    Add Lesson
                  </button>
                </div>
              </div>

        {/* ── CREATE COURSE TAB ── */}
        {activeTab === 'create-course' && (
          <div>
            <Card className="shadow-lg">
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <PlusCircle className="h-5 w-5 text-blue-600" aria-hidden="true" />
                  New Course
                </CardTitle>
              </CardHeader>
              <CardContent className="p-6">
                {courseSuccess && (
                  <Alert className="mb-4 bg-green-50 border-green-200 text-green-800">
                    <CheckCircle2 className="h-4 w-4" />
                    <AlertTitle>Success</AlertTitle>
                    <AlertDescription>{courseSuccess}</AlertDescription>
                  </Alert>
                )}
                {courseError && (
                  <Alert variant="destructive" className="mb-4">
                    <AlertCircle className="h-4 w-4" />
                    <AlertTitle>Error</AlertTitle>
                    <AlertDescription>{courseError}</AlertDescription>
                  </Alert>
                )}

                <form onSubmit={handleCourseSubmit} className="space-y-6">
                  <div className="space-y-2">
                    <Label htmlFor="course-title">
                      Title <span className="text-red-500">*</span>
                    </Label>
                    <Input
                      id="course-title"
                      placeholder="e.g. Introduction to Python"
                      required
                      value={courseForm.title}
                      onChange={(e) => handleCourseChange('title', e.target.value)}
                    />
                  </div>

                  <div className="space-y-2">
                    <Label htmlFor="course-description">
                      Description <span className="text-red-500">*</span>
                    </Label>
                    <Textarea
                      id="course-description"
                      placeholder="Describe what students will learn..."
                      rows={4}
                      required
                      value={courseForm.description}
                      onChange={(e) => handleCourseChange('description', e.target.value)}
                    />
                  </div>

                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <div className="space-y-2">
                      <Label htmlFor="course-category">
                        Category <span className="text-red-500">*</span>
                      </Label>
                      <Select
                        value={courseForm.category}
                        onValueChange={(val) => handleCourseChange('category', val)}
                      >
                        <SelectTrigger id="course-category">
                          <SelectValue placeholder="Select category" />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="Technology">Technology</SelectItem>
                          <SelectItem value="Science">Science</SelectItem>
                          <SelectItem value="Mathematics">Mathematics</SelectItem>
                          <SelectItem value="Language">Language</SelectItem>
                          <SelectItem value="Arts">Arts</SelectItem>
                          <SelectItem value="Other">Other</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>

                    <div className="space-y-2">
                      <Label htmlFor="course-difficulty">Difficulty</Label>
                      <Select
                        value={courseForm.difficulty}
                        onValueChange={(val) => handleCourseChange('difficulty', val)}
                      >
                        <SelectTrigger id="course-difficulty">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="beginner">Beginner</SelectItem>
                          <SelectItem value="intermediate">Intermediate</SelectItem>
                          <SelectItem value="advanced">Advanced</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                  </div>

                  <div className="flex gap-4 pt-4">
                    <Button
                      type="button"
                      variant="outline"
                      onClick={() => router.push('/teacher/dashboard')}
                    >
                      Cancel
                    </Button>
                    <Button type="submit" disabled={courseSubmitting}>
                      {courseSubmitting ? (
                        <>
                          <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                          Creating...
                        </>
                      ) : (
                        'Create Course'
                      )}
                    </Button>
                  </div>
                </form>
              </CardContent>
            </Card>
          </div>
        )}

        {/* ── ADD LESSON TAB ── */}
        {activeTab === 'add-lesson' && (
          <div>
            <Card className="shadow-lg">
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <FileVideo className="h-5 w-5 text-blue-600" aria-hidden="true" />
                  Add Lesson
                </CardTitle>
              </CardHeader>
              <CardContent className="p-6">
                {lessonSuccess && (
                  <Alert className="mb-4 bg-green-50 border-green-200 text-green-800">
                    <CheckCircle2 className="h-4 w-4" />
                    <AlertTitle>Success</AlertTitle>
                    <AlertDescription>{lessonSuccess}</AlertDescription>
                  </Alert>
                )}
                {lessonError && (
                  <Alert variant="destructive" className="mb-4">
                    <AlertCircle className="h-4 w-4" />
                    <AlertTitle>Error</AlertTitle>
                    <AlertDescription>{lessonError}</AlertDescription>
                  </Alert>
                )}

                <form onSubmit={handleLessonSubmit} className="space-y-6">
                  {/* Course selector */}
                  <div className="space-y-2">
                    <Label htmlFor="lesson-course">
                      Course <span className="text-red-500">*</span>
                    </Label>
                    <Select
                      value={lessonForm.courseId}
                      onValueChange={(val) => handleLessonChange('courseId', val)}
                    >
                      <SelectTrigger id="lesson-course">
                        <SelectValue
                          placeholder={loadingCourses ? 'Loading courses…' : 'Select a course'}
                        />
                      </SelectTrigger>
                      <SelectContent>
                        {courses.map((course) => (
                          <SelectItem key={course.id} value={course.id.toString()}>
                            {course.title}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    {!loadingCourses && courses.length === 0 && (
                      <p className="text-sm text-amber-600">
                        No courses yet.{' '}
                        <button
                          type="button"
                          className="underline"
                          onClick={() => setActiveTab('create-course')}
                        >
                          Create one first.
                        </button>
                      </p>
                    )}
                  </div>

                  {/* Lesson title */}
                  <div className="space-y-2">
                    <Label htmlFor="lesson-title">
                      Lesson Title <span className="text-red-500">*</span>
                    </Label>
                    <Input
                      id="lesson-title"
                      placeholder="e.g. Variables and Data Types"
                      required
                      value={lessonForm.title}
                      onChange={(e) => handleLessonChange('title', e.target.value)}
                    />
                  </div>

                  {/* Video file input */}
                  <div className="space-y-2">
                    <Label htmlFor="video-file">
                      Video File (Optional)
                    </Label>
                    <input
                      ref={videoInputRef}
                      id="video-file"
                      type="file"
                      accept="video/*"
                      onChange={handleVideoChange}
                      className="block w-full text-sm text-gray-700 file:mr-4 file:py-2 file:px-4 file:rounded-md file:border-0 file:text-sm file:font-medium file:bg-blue-50 file:text-blue-700 hover:file:bg-blue-100 border border-gray-300 rounded-md p-1 cursor-pointer"
                    />
                    {videoFile && (
                      <p className="text-xs text-green-700">
                        Selected: {videoFile.name} ({(videoFile.size / 1024 / 1024).toFixed(1)} MB)
                      </p>
                    )}
                  </div>

                  <div className="space-y-2">
                    <Label htmlFor="document-file">
                      Lesson Document (Optional)
                    </Label>
                    <input
                      ref={documentInputRef}
                      id="document-file"
                      type="file"
                      accept=".pdf,.ppt,.pptx"
                      onChange={handleDocumentChange}
                      className="block w-full text-sm text-gray-700 file:mr-4 file:py-2 file:px-4 file:rounded-md file:border-0 file:text-sm file:font-medium file:bg-blue-50 file:text-blue-700 hover:file:bg-blue-100 border border-gray-300 rounded-md p-1 cursor-pointer"
                    />
                    {documentFile && (
                      <p className="text-xs text-green-700">
                        Selected: {documentFile.name} ({(documentFile.size / 1024 / 1024).toFixed(1)} MB)
                      </p>
                    )}
                    <p className="text-xs text-gray-400">Accepted formats: PDF, PPT, PPTX</p>
                  </div>

                  {/* Description */}
                  <div className="space-y-2">
                    <Label htmlFor="lesson-description">Description</Label>
                    <Textarea
                      id="lesson-description"
                      placeholder="Describe what students will learn in this lesson..."
                      rows={4}
                      value={lessonForm.description}
                      onChange={(e) => handleLessonChange('description', e.target.value)}
                    />
                  </div>

                  {/* Duration */}
                  <div className="space-y-2">
                    <Label htmlFor="lesson-duration">Duration (minutes)</Label>
                    <Input
                      id="lesson-duration"
                      type="number"
                      min={1}
                      value={lessonForm.durationMinutes}
                      onChange={(e) =>
                        handleLessonChange('durationMinutes', parseInt(e.target.value) || 1)
                      }
                    />
                  </div>

                  <div className="flex gap-4 pt-4">
                    <Button
                      type="button"
                      variant="outline"
                      onClick={() => router.push('/teacher/dashboard')}
                    >
                      Cancel
                    </Button>
                    <Button type="submit" disabled={lessonSubmitting}>
                      {lessonSubmitting ? (
                        <>
                          <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                          Uploading...
                        </>
                      ) : (
                        'Add Lesson'
                      )}
                    </Button>
                  </div>
                </form>
              </CardContent>
            </Card>
          </div>
        )}

        {/* AI Accessibility panel — shown after a lesson is successfully created */}
        {createdLesson && (
          <div>
            <Card className="border-purple-200 shadow-lg">
              <CardHeader>
                <CardTitle className="flex items-center gap-2 text-purple-900">
                  <Wand2 className="h-5 w-5 text-purple-600" aria-hidden="true" />
                  AI Accessibility — {createdLesson.title}
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-4 p-6">
                <p className="text-sm text-gray-600">
                  Automatically generate accessibility assets for the lesson you just uploaded.
                  Both jobs run in the background — you can leave this page.
                </p>

                {/* STT — Video → Subtitles */}
                {createdLesson.video_url && (
                  <div className="flex items-center justify-between rounded-lg border border-gray-200 p-4">
                    <div className="flex items-center gap-3">
                      <Mic className="h-5 w-5 text-blue-600 flex-shrink-0" aria-hidden="true" />
                      <div>
                        <p className="font-medium text-sm text-gray-900">Generate Subtitles (STT)</p>
                        <p className="text-xs text-gray-500">
                          Transcribes the video using Whisper AI → .vtt subtitle file
                        </p>
                      </div>
                    </div>
                    <div className="flex items-center gap-3">
                      {aiJob.stt.status === 'completed' && (
                        <span className="text-xs text-green-700 font-medium flex items-center gap-1">
                          <CheckCircle2 className="h-4 w-4" /> Done
                        </span>
                      )}
                      {aiJob.stt.status === 'failed' && (
                        <span className="text-xs text-red-600">{aiJob.stt.error || 'Failed'}</span>
                      )}
                      {aiJob.stt.status && !['completed', 'failed', '', 'submitting'].includes(aiJob.stt.status) && (
                        <span className="text-xs text-blue-600 flex items-center gap-1">
                          <Loader2 className="h-3 w-3 animate-spin" />
                          {aiJob.stt.progress || aiJob.stt.status}
                        </span>
                      )}
                      <Button
                        size="sm"
                        disabled={
                          aiJob.stt.submitting ||
                          ['queued', 'downloading', 'processing', 'completed'].includes(aiJob.stt.status)
                        }
                        onClick={() => handleGenerateAI('stt')}
                      >
                        {aiJob.stt.submitting ? <Loader2 className="h-4 w-4 animate-spin" /> : 'Generate'}
                      </Button>
                    </div>
                  </div>
                )}

                {/* TTS — Document → Audio */}
                {createdLesson.document_url && (
                  <div className="flex items-center justify-between rounded-lg border border-gray-200 p-4">
                    <div className="flex items-center gap-3">
                      <Headphones className="h-5 w-5 text-purple-600 flex-shrink-0" aria-hidden="true" />
                      <div>
                        <p className="font-medium text-sm text-gray-900">Generate Audio (TTS)</p>
                        <p className="text-xs text-gray-500">
                          Converts the document to spoken audio using Piper TTS → .mp3
                        </p>
                      </div>
                    </div>
                    <div className="flex items-center gap-3">
                      {aiJob.tts.status === 'completed' && (
                        <span className="text-xs text-green-700 font-medium flex items-center gap-1">
                          <CheckCircle2 className="h-4 w-4" /> Done
                        </span>
                      )}
                      {aiJob.tts.status === 'failed' && (
                        <span className="text-xs text-red-600">{aiJob.tts.error || 'Failed'}</span>
                      )}
                      {aiJob.tts.status && !['completed', 'failed', '', 'submitting'].includes(aiJob.tts.status) && (
                        <span className="text-xs text-purple-600 flex items-center gap-1">
                          <Loader2 className="h-3 w-3 animate-spin" />
                          {aiJob.tts.progress || aiJob.tts.status}
                        </span>
                      )}
                      <Button
                        size="sm"
                        variant="outline"
                        disabled={
                          aiJob.tts.submitting ||
                          ['queued', 'downloading', 'processing', 'completed'].includes(aiJob.tts.status)
                        }
                        onClick={() => handleGenerateAI('tts')}
                      >
                        {aiJob.tts.submitting ? <Loader2 className="h-4 w-4 animate-spin" /> : 'Generate'}
                      </Button>
                    </div>
                  </div>
                )}

                {!createdLesson.video_url && !createdLesson.document_url && (
                  <p className="text-sm text-gray-500">No media attached to this lesson.</p>
                )}
              </CardContent>
            </Card>
          </div>
        )}

        {/* Tips card */}
        <div>
          <Card className="bg-blue-50 border-blue-200 shadow-lg">
            <CardHeader>
              <CardTitle className="text-blue-900 text-base">Tips</CardTitle>
            </CardHeader>
            <CardContent>
              <ul className="space-y-2 text-blue-800 text-sm" role="list">
                <li>• Create a course first, then add lessons to it via the "Add Lesson" tab.</li>
                <li>• Video files are uploaded directly from your computer — no URL needed.</li>
                <li>• Ensure videos have clear audio and are captioned for accessibility.</li>
                <li>• Use descriptive titles so students know what to expect.</li>
              </ul>
            </CardContent>
          </Card>
        </div>
      </div>
</DashboardLayout>
</RouteGuard>
);
}
