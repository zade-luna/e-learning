'use client';

import { use, useState, useEffect, useCallback } from 'react';
import { DashboardLayout } from '@/components/dashboard-layout-new';
import { useCommonShortcuts } from '@/hooks/use-keyboard-shortcuts';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from '@/components/ui/table';
import {
  Tooltip, TooltipContent, TooltipProvider, TooltipTrigger,
} from '@/components/ui/tooltip';
import {
  ArrowLeft,
  Edit,
  Trash2,
  Users,
  BookOpen,
  Calendar,
  Clock,
  FileText,
  Plus,
  Loader2,
  HelpCircle,
  Video,
  Headphones,
  Mic,
  CheckCircle2,
  ChevronDown,
  ChevronUp,
  ExternalLink,
  Wand2,
} from 'lucide-react';
import { coursesAPI, lessonsAPI, enrollmentsAPI, quizzesAPI, accessibilityAPI, getServerOrigin } from '@/lib/api';
import { useAuth } from '@/lib/auth-context';
import { useAccessibilitySocket } from '@/hooks/use-accessibility-socket';
import { RouteGuard } from '@/lib/route-guard';
import { EditCourseDialog } from '@/components/dialogs/edit-course-dialog';
import { DeleteConfirmDialog } from '@/components/dialogs/delete-confirm-dialog';
import { AddLessonDialog } from '@/components/dialogs/add-lesson-dialog';
import { EditLessonDialog } from '@/components/dialogs/edit-lesson-dialog';
import { AddQuizDialog } from '@/components/dialogs/add-quiz-dialog';
import { EditQuizDialog } from '@/components/dialogs/edit-quiz-dialog';
import { QuizManagementDialog } from '@/components/dialogs/quiz-management-dialog';

interface Quiz {
  id: number;
  title: string;
  description?: string;
  passing_score: number;
  time_limit_minutes?: number;
  question_count: number;
  created_at: string;
}

interface Lesson {
  id: number;
  title: string;
  duration: string;
  order: number;
  description?: string;
  video_url?: string;
  document_url?: string;
  subtitle_url?: string;
  audio_url?: string;
}

interface LessonJob {
  id: number;
  job_id: string;
  job_type: 'stt' | 'tts';
  status: string;
  created_at: string;
}

interface Student {
  id: number;
  name: string;
  email: string;
  enrolledDate: string;
  progress: number;
  status: string;
}

interface CourseData {
  id: number;
  title: string;
  instructor: string;
  description: string;
  status: string;
  created: string;
  totalStudents: number;
  totalLessons: number;
  duration: string;
  category: string;
}

export default function TeacherCourseDetailPage({ params }: { params: Promise<{ id: string }> }) {
  useCommonShortcuts('teacher');

  const { id } = use(params);
  const { user } = useAuth();

  const [course, setCourse] = useState<CourseData | null>(null);
  const [lessons, setLessons] = useState<Lesson[]>([]);
  const [expandedLesson, setExpandedLesson] = useState<number | null>(null);
  const [lessonJobs, setLessonJobs] = useState<Record<number, LessonJob[]>>({});
  const [submittingJob, setSubmittingJob] = useState<Record<string, boolean>>({});

  // WebSocket: update job status in real-time when a job finishes
  const handleJobDone = useCallback((payload: { jobId: string; jobType: 'stt' | 'tts'; lessonId: number; status: string; url?: string }) => {
    // Update jobs list for the affected lesson
    setLessonJobs((prev) => {
      const jobs = prev[payload.lessonId] ?? [];
      const updated = jobs.map((j) =>
        j.job_id === payload.jobId ? { ...j, status: payload.status } : j
      );
      return { ...prev, [payload.lessonId]: updated };
    });
    // Update lesson media url if completed
    if (payload.status === 'completed' && payload.url) {
      setLessons((prev) =>
        prev.map((l) =>
          l.id === payload.lessonId
            ? { ...l, [payload.jobType === 'stt' ? 'subtitle_url' : 'audio_url']: payload.url }
            : l
        )
      );
    }
    setSubmittingJob((prev) => ({ ...prev, [`${payload.lessonId}-${payload.jobType}`]: false }));
  }, []);

  useAccessibilitySocket(user?.id, handleJobDone);
  const [quizzes, setQuizzes] = useState<Quiz[]>([]);
  const [students, setStudents] = useState<Student[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  // Dialog state
  const [editingCourse, setEditingCourse] = useState(false);
  const [deletingCourse, setDeletingCourse] = useState(false);
  const [deletingLesson, setDeletingLesson] = useState<Lesson | null>(null);
  const [addingLesson, setAddingLesson] = useState(false);
  const [editingLesson, setEditingLesson] = useState<Lesson | null>(null);
  
  // Quiz dialog state
  const [addingQuiz, setAddingQuiz] = useState(false);
  const [editingQuiz, setEditingQuiz] = useState<Quiz | null>(null);
  const [deletingQuiz, setDeletingQuiz] = useState<Quiz | null>(null);
  const [managingQuiz, setManagingQuiz] = useState<Quiz | null>(null);

  useEffect(() => {
    fetchCourseData();
    fetchEnrollments();
    fetchQuizzes();
  }, [id]);

  const fetchCourseData = async () => {
    try {
      setLoading(true);
      setError('');
      const data = await coursesAPI.getById(parseInt(id));
      setCourse({
        id: data.id,
        title: data.title,
        instructor: data.teacher_name || 'Unknown',
        description: data.description || '',
        status: (data.status || 'active').charAt(0).toUpperCase() + (data.status || 'active').slice(1),
        created: new Date(data.created_at).toISOString().split('T')[0],
        totalStudents: data.enrollment_count || 0,
        totalLessons: data.lessons?.length || 0,
        duration: data.duration || 'N/A',
        category: data.category || 'Uncategorized',
      });
      setLessons(
        (data.lessons || [])
          .map((l: any) => ({
            id: l.id,
            title: l.title,
            duration: l.duration_minutes ? `${l.duration_minutes} min` : '0 min',
            order: l.order_index,
            description: l.description || '',
            video_url: l.video_url || '',
            document_url: l.document_url || '',
            subtitle_url: l.subtitle_url || '',
            audio_url: l.audio_url || '',
          }))
          .sort((a: Lesson, b: Lesson) => a.order - b.order)
      );
    } catch (err: any) {
      console.error('Failed to fetch course details:', err);
      setError(err.message || 'Failed to load course details');
    } finally {
      setLoading(false);
    }
  };

  const fetchEnrollments = async () => {
    try {
      const data = await enrollmentsAPI.getByCourse(parseInt(id));
      setStudents(
        data.map((e: any) => ({
          id: e.student_id,
          name: e.full_name,
          email: e.email,
          enrolledDate: new Date(e.enrolled_at).toISOString().split('T')[0],
          progress: e.progress || 0,
          status: 'Active',
        }))
      );
    } catch (err: any) {
      console.error('Failed to fetch enrollments:', err);
      // Non-blocking — students list stays empty
    }
  };

  const fetchQuizzes = async () => {
    try {
      const data = await quizzesAPI.getByCourse(parseInt(id));
      setQuizzes(
        data.map((q: any) => ({
          id: q.id,
          title: q.title,
          description: q.description,
          passing_score: q.passing_score,
          time_limit_minutes: q.time_limit_minutes,
          question_count: q.question_count || 0,
          created_at: q.created_at,
        }))
      );
    } catch (err: any) {
      console.error('Failed to fetch quizzes:', err);
      // Non-blocking — quizzes list stays empty
    }
  };

  const handleDeleteCourse = async () => {
    if (!course) return;
    try {
      await coursesAPI.delete(course.id);
      window.location.href = '/teacher/courses';
    } catch (err: any) {
      console.error('Failed to delete course:', err);
      setError('Failed to delete course');
    }
  };

  const handleDeleteLesson = async (lessonId: number) => {
    try {
      await lessonsAPI.delete(lessonId);
      setLessons(lessons.filter((l) => l.id !== lessonId));
      setDeletingLesson(null);
    } catch (err: any) {
      console.error('Failed to delete lesson:', err);
      setError('Failed to delete lesson');
    }
  };

  const handleAddLesson = (newLesson: any) => {
    setLessons(
      [
        ...lessons,
        {
          id: newLesson.id,
          title: newLesson.title,
          duration: newLesson.duration_minutes ? `${newLesson.duration_minutes} min` : '0 min',
          order: newLesson.order_index,
          description: newLesson.description || '',
          video_url: newLesson.video_url || '',
          document_url: newLesson.document_url || '',
          subtitle_url: newLesson.subtitle_url || '',
          audio_url: newLesson.audio_url || '',
        },
      ].sort((a, b) => a.order - b.order)
    );
    fetchCourseData();
    // Auto-submit AI jobs for new lesson
    if (newLesson.video_url) submitAiJob(newLesson.id, 'stt');
    if (newLesson.document_url) submitAiJob(newLesson.id, 'tts');
  };

  const fetchLessonJobs = async (lessonId: number) => {
    try {
      const jobs = await accessibilityAPI.getLessonJobs(lessonId) as LessonJob[];
      setLessonJobs((prev) => ({ ...prev, [lessonId]: jobs }));
    } catch {
      // non-blocking
    }
  };

  const handleToggleLesson = (lessonId: number) => {
    setExpandedLesson((prev) => {
      const next = prev === lessonId ? null : lessonId;
      if (next !== null) fetchLessonJobs(next);
      return next;
    });
  };

  const submitAiJob = async (lessonId: number, jobType: 'stt' | 'tts') => {
    const key = `${lessonId}-${jobType}`;
    setSubmittingJob((prev) => ({ ...prev, [key]: true }));
    try {
      const data: any = await accessibilityAPI.submitJob(lessonId, jobType);
      setLessonJobs((prev) => ({
        ...prev,
        [lessonId]: [{ id: Date.now(), job_id: data.job_id, job_type: jobType, status: data.status, created_at: new Date().toISOString() }, ...(prev[lessonId] ?? [])],
      }));
    } catch {
      setSubmittingJob((prev) => ({ ...prev, [key]: false }));
    }
  };

  const handleEditLesson = (updatedLesson: Lesson) => {
    setLessons(
      lessons
        .map((l) => (l.id === updatedLesson.id ? updatedLesson : l))
        .sort((a, b) => a.order - b.order)
    );
  };

  const handleAddQuiz = (newQuiz: any) => {
    setQuizzes([
      ...quizzes,
      {
        id: newQuiz.id,
        title: newQuiz.title,
        description: newQuiz.description,
        passing_score: newQuiz.passing_score,
        time_limit_minutes: newQuiz.time_limit_minutes,
        question_count: 0,
        created_at: newQuiz.created_at,
      },
    ]);
  };

  const handleEditQuiz = (updatedQuiz: any) => {
    setQuizzes(quizzes.map((q) => (q.id === updatedQuiz.id ? {
      ...q,
      title: updatedQuiz.title,
      description: updatedQuiz.description,
      passing_score: updatedQuiz.passing_score,
      time_limit_minutes: updatedQuiz.time_limit_minutes,
    } : q)));
  };

  const handleDeleteQuiz = async (quizId: number) => {
    try {
      await quizzesAPI.delete(quizId);
      setQuizzes(quizzes.filter((q) => q.id !== quizId));
      setDeletingQuiz(null);
    } catch (err: any) {
      console.error('Failed to delete quiz:', err);
      setError('Failed to delete quiz');
    }
  };

  if (loading && !course) {
    return (
      <RouteGuard allowedRoles={['teacher']}>
        <DashboardLayout role="teacher" userName="Teacher" userRole="Teacher">
          <div className="flex items-center justify-center min-h-[400px]">
            <Loader2 className="h-8 w-8 animate-spin text-blue-600" />
          </div>
        </DashboardLayout>
      </RouteGuard>
    );
  }

  if (error && !course) {
    return (
      <RouteGuard allowedRoles={['teacher']}>
        <DashboardLayout role="teacher" userName="Teacher" userRole="Teacher">
          <div className="bg-red-50 border border-red-200 rounded-lg p-6 text-center">
            <h2 className="text-lg font-semibold text-red-800 mb-2">Error Loading Course</h2>
            <p className="text-red-700 mb-4">{error}</p>
            <Button onClick={() => window.history.back()}>Go Back</Button>
          </div>
        </DashboardLayout>
      </RouteGuard>
    );
  }

  if (!course) return null;

  return (
    <RouteGuard allowedRoles={['teacher']}>
      <DashboardLayout role="teacher" userName="Teacher" userRole="Teacher">
        <div className="space-y-6">
          {/* Inline error alert */}
          {error && (
            <div className="bg-red-50 border border-red-200 rounded-lg p-4 text-red-700">
              {error}
            </div>
          )}

          {/* Header */}
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-4">
              <Button
                variant="outline"
                size="sm"
                onClick={() => window.history.back()}
                className="gap-2"
              >
                <ArrowLeft className="h-4 w-4" aria-hidden="true" />
                Back
              </Button>
              <div>
                <div className="flex items-center gap-3 mb-2">
                  <h1 className="text-3xl font-bold text-gray-900">{course.title}</h1>
                  <Badge variant={course.status === 'Active' ? 'default' : 'secondary'}>
                    {course.status}
                  </Badge>
                </div>
                <p className="text-gray-600">Instructor: {course.instructor}</p>
              </div>
            </div>
            <div className="flex gap-2">
              <TooltipProvider>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Button variant="outline" size="sm" onClick={() => setEditingCourse(true)}>
                      <Edit className="h-4 w-4" aria-hidden="true" />
                    </Button>
                  </TooltipTrigger>
                  <TooltipContent>
                    <p>Edit course</p>
                  </TooltipContent>
                </Tooltip>
              </TooltipProvider>

              <TooltipProvider>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Button variant="outline" size="sm" onClick={() => setDeletingCourse(true)}>
                      <Trash2 className="h-4 w-4 text-red-600" aria-hidden="true" />
                    </Button>
                  </TooltipTrigger>
                  <TooltipContent>
                    <p>Delete course</p>
                  </TooltipContent>
                </Tooltip>
              </TooltipProvider>
            </div>
          </div>

          {/* Stats Cards */}
          <div className="grid grid-cols-1 md:grid-cols-4 gap-6">
            <Card>
              <CardContent className="pt-6">
                <div className="flex items-center gap-4">
                  <div className="bg-blue-100 p-3 rounded-lg">
                    <Users className="h-6 w-6 text-blue-700" aria-hidden="true" />
                  </div>
                  <div>
                    <p className="text-sm text-gray-600">Total Students</p>
                    <p className="text-2xl font-bold">{course.totalStudents}</p>
                  </div>
                </div>
              </CardContent>
            </Card>

            <Card>
              <CardContent className="pt-6">
                <div className="flex items-center gap-4">
                  <div className="bg-green-100 p-3 rounded-lg">
                    <BookOpen className="h-6 w-6 text-green-700" aria-hidden="true" />
                  </div>
                  <div>
                    <p className="text-sm text-gray-600">Total Lessons</p>
                    <p className="text-2xl font-bold">{course.totalLessons}</p>
                  </div>
                </div>
              </CardContent>
            </Card>

            <Card>
              <CardContent className="pt-6">
                <div className="flex items-center gap-4">
                  <div className="bg-purple-100 p-3 rounded-lg">
                    <Clock className="h-6 w-6 text-purple-700" aria-hidden="true" />
                  </div>
                  <div>
                    <p className="text-sm text-gray-600">Duration</p>
                    <p className="text-2xl font-bold">{course.duration}</p>
                  </div>
                </div>
              </CardContent>
            </Card>

            <Card>
              <CardContent className="pt-6">
                <div className="flex items-center gap-4">
                  <div className="bg-orange-100 p-3 rounded-lg">
                    <Calendar className="h-6 w-6 text-orange-700" aria-hidden="true" />
                  </div>
                  <div>
                    <p className="text-sm text-gray-600">Created</p>
                    <p className="text-2xl font-bold">{course.created}</p>
                  </div>
                </div>
              </CardContent>
            </Card>
          </div>

          {/* Course Description */}
          <Card>
            <CardHeader>
              <CardTitle>Course Description</CardTitle>
            </CardHeader>
            <CardContent>
              <p className="text-gray-700 leading-relaxed">{course.description}</p>
              <div className="mt-4">
                <Badge variant="outline">{course.category}</Badge>
              </div>
            </CardContent>
          </Card>

          {/* Lessons */}
          <Card>
            <CardHeader className="flex flex-row items-center justify-between">
              <CardTitle>Course Content ({lessons.length} Lessons)</CardTitle>
              <Button size="sm" className="gap-2" onClick={() => setAddingLesson(true)}>
                <Plus className="h-4 w-4" aria-hidden="true" />
                Add Lesson
              </Button>
            </CardHeader>
            <CardContent className="space-y-3">
              {lessons.length === 0 && (
                <p className="text-center text-gray-500 py-8">No lessons yet. Add your first lesson above.</p>
              )}
              {lessons.map((lesson) => {
                const isExpanded = expandedLesson === lesson.id;
                const jobs = lessonJobs[lesson.id] ?? [];
                const latestStt = jobs.find((j) => j.job_type === 'stt');
                const latestTts = jobs.find((j) => j.job_type === 'tts');
                const sttKey = `${lesson.id}-stt`;
                const ttsKey = `${lesson.id}-tts`;

                return (
                  <div key={lesson.id} className="border rounded-lg overflow-hidden">
                    {/* Lesson header row */}
                    <button
                      type="button"
                      className="w-full flex items-center justify-between px-4 py-3 bg-gray-50 hover:bg-gray-100 transition-colors text-left"
                      onClick={() => handleToggleLesson(lesson.id)}
                      aria-expanded={isExpanded}
                    >
                      <div className="flex items-center gap-3">
                        <span className="text-xs font-mono bg-gray-200 rounded px-2 py-0.5">{lesson.order}</span>
                        <span className="font-medium text-gray-900">{lesson.title}</span>
                        <span className="text-xs text-gray-500">{lesson.duration}</span>
                        {/* Media badges */}
                        {lesson.video_url && <span className="inline-flex items-center gap-1 text-xs text-blue-700 bg-blue-50 border border-blue-200 rounded px-2 py-0.5"><Video className="h-3 w-3" />Video</span>}
                        {lesson.document_url && <span className="inline-flex items-center gap-1 text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded px-2 py-0.5"><FileText className="h-3 w-3" />Doc</span>}
                        {lesson.subtitle_url && <span className="inline-flex items-center gap-1 text-xs text-green-700 bg-green-50 border border-green-200 rounded px-2 py-0.5"><CheckCircle2 className="h-3 w-3" />Subtitles</span>}
                        {lesson.audio_url && <span className="inline-flex items-center gap-1 text-xs text-purple-700 bg-purple-50 border border-purple-200 rounded px-2 py-0.5"><Headphones className="h-3 w-3" />Audio</span>}
                      </div>
                      <div className="flex items-center gap-2">
                        <Button variant="ghost" size="sm" onClick={(e) => { e.stopPropagation(); setEditingLesson(lesson); }} aria-label="Edit lesson">
                          <Edit className="h-4 w-4" />
                        </Button>
                        <Button variant="ghost" size="sm" onClick={(e) => { e.stopPropagation(); setDeletingLesson(lesson); }} aria-label="Delete lesson">
                          <Trash2 className="h-4 w-4 text-red-500" />
                        </Button>
                        {isExpanded ? <ChevronUp className="h-4 w-4 text-gray-400" /> : <ChevronDown className="h-4 w-4 text-gray-400" />}
                      </div>
                    </button>

                    {/* Expanded content */}
                    {isExpanded && (
                      <div className="p-4 space-y-5 bg-white">
                        {lesson.description && (
                          <p className="text-sm text-gray-600">{lesson.description}</p>
                        )}

                        {/* Video player */}
                        {lesson.video_url && (
                          <div className="space-y-2">
                            <h4 className="text-sm font-semibold text-gray-700 flex items-center gap-2"><Video className="h-4 w-4 text-blue-600" />Video</h4>
                            <video
                              src={`${getServerOrigin()}${lesson.video_url}`}
                              controls
                              className="w-full max-h-72 rounded-lg bg-black"
                              aria-label={`Video for ${lesson.title}`}
                            >
                              {lesson.subtitle_url && (
                                <track
                                  kind="subtitles"
                                  src={`${getServerOrigin()}${lesson.subtitle_url}`}
                                  srcLang="en"
                                  label="English"
                                  default
                                />
                              )}
                            </video>
                          </div>
                        )}

                        {/* Document link */}
                        {lesson.document_url && (
                          <div className="space-y-2">
                            <h4 className="text-sm font-semibold text-gray-700 flex items-center gap-2"><FileText className="h-4 w-4 text-amber-600" />Document</h4>
                            <a
                              href={`${getServerOrigin()}${lesson.document_url}`}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="inline-flex items-center gap-2 text-sm text-blue-600 underline hover:text-blue-800"
                            >
                              <ExternalLink className="h-4 w-4" />
                              Open document
                            </a>
                          </div>
                        )}

                        {/* Audio player */}
                        {lesson.audio_url && (
                          <div className="space-y-2">
                            <h4 className="text-sm font-semibold text-gray-700 flex items-center gap-2"><Headphones className="h-4 w-4 text-purple-600" />AI Audio</h4>
                            <audio
                              src={`${getServerOrigin()}${lesson.audio_url}`}
                              controls
                              className="w-full"
                              aria-label={`Audio narration for ${lesson.title}`}
                            />
                          </div>
                        )}

                        {/* AI Accessibility jobs */}
                        <div className="border-t pt-4">
                          <h4 className="text-sm font-semibold text-gray-700 flex items-center gap-2 mb-3"><Wand2 className="h-4 w-4 text-purple-600" />AI Accessibility</h4>
                          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                            {/* STT */}
                            {lesson.video_url && (
                              <div className="border rounded-lg p-3 flex items-center justify-between gap-3">
                                <div className="flex items-center gap-2">
                                  <Mic className="h-4 w-4 text-blue-600" />
                                  <div>
                                    <p className="text-xs font-medium">Generate Subtitles (STT)</p>
                                    {latestStt ? (
                                      <p className={`text-xs ${ latestStt.status === 'completed' ? 'text-green-600' : latestStt.status === 'failed' ? 'text-red-500' : 'text-blue-500'}`}>
                                        {latestStt.status === 'completed' ? '✓ Done' : latestStt.status}
                                      </p>
                                    ) : (
                                      <p className="text-xs text-gray-400">{lesson.subtitle_url ? '✓ Subtitle ready' : 'Not generated'}</p>
                                    )}
                                  </div>
                                </div>
                                <Button
                                  size="sm"
                                  variant="outline"
                                  disabled={submittingJob[sttKey] || latestStt?.status === 'queued' || latestStt?.status === 'processing'}
                                  onClick={() => submitAiJob(lesson.id, 'stt')}
                                >
                                  {submittingJob[sttKey] ? <Loader2 className="h-3 w-3 animate-spin" /> : lesson.subtitle_url ? 'Re-run' : 'Generate'}
                                </Button>
                              </div>
                            )}
                            {/* TTS */}
                            {lesson.document_url && (
                              <div className="border rounded-lg p-3 flex items-center justify-between gap-3">
                                <div className="flex items-center gap-2">
                                  <Headphones className="h-4 w-4 text-purple-600" />
                                  <div>
                                    <p className="text-xs font-medium">Generate Audio (TTS)</p>
                                    {latestTts ? (
                                      <p className={`text-xs ${ latestTts.status === 'completed' ? 'text-green-600' : latestTts.status === 'failed' ? 'text-red-500' : 'text-purple-500'}`}>
                                        {latestTts.status === 'completed' ? '✓ Done' : latestTts.status}
                                      </p>
                                    ) : (
                                      <p className="text-xs text-gray-400">{lesson.audio_url ? '✓ Audio ready' : 'Not generated'}</p>
                                    )}
                                  </div>
                                </div>
                                <Button
                                  size="sm"
                                  variant="outline"
                                  disabled={submittingJob[ttsKey] || latestTts?.status === 'queued' || latestTts?.status === 'processing'}
                                  onClick={() => submitAiJob(lesson.id, 'tts')}
                                >
                                  {submittingJob[ttsKey] ? <Loader2 className="h-3 w-3 animate-spin" /> : lesson.audio_url ? 'Re-run' : 'Generate'}
                                </Button>
                              </div>
                            )}
                          </div>
                        </div>
                      </div>
                    )}
                  </div>
                );
              })}
            </CardContent>
          </Card>

          {/* Quizzes Table */}
          <Card>
            <CardHeader className="flex flex-row items-center justify-between">
              <CardTitle>Course Quizzes ({quizzes.length})</CardTitle>
              <Button size="sm" className="gap-2" onClick={() => setAddingQuiz(true)}>
                <Plus className="h-4 w-4" aria-hidden="true" />
                Add Quiz
              </Button>
            </CardHeader>
            <CardContent>
              {quizzes.length === 0 ? (
                <div className="flex flex-col items-center justify-center py-8 text-gray-500">
                  <HelpCircle className="h-12 w-12 mb-2 text-gray-300" />
                  <p className="text-lg font-medium">No quizzes yet</p>
                  <p className="text-sm">Add your first quiz to assess student learning</p>
                </div>
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Quiz Title</TableHead>
                      <TableHead>Questions</TableHead>
                      <TableHead>Passing Score</TableHead>
                      <TableHead>Time Limit</TableHead>
                      <TableHead className="text-right">Actions</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {quizzes.map((quiz) => (
                      <TableRow key={quiz.id}>
                        <TableCell>
                          <div className="flex items-center gap-2">
                            <HelpCircle className="h-4 w-4 text-gray-400" aria-hidden="true" />
                            <div>
                              <p className="font-medium">{quiz.title}</p>
                              {quiz.description && (
                                <p className="text-sm text-gray-500 truncate max-w-xs">
                                  {quiz.description}
                                </p>
                              )}
                            </div>
                          </div>
                        </TableCell>
                        <TableCell>{quiz.question_count}</TableCell>
                        <TableCell>{quiz.passing_score}%</TableCell>
                        <TableCell>
                          {quiz.time_limit_minutes ? `${quiz.time_limit_minutes} min` : 'No limit'}
                        </TableCell>
                        <TableCell className="text-right">
                          <div className="flex justify-end gap-2">
                            <TooltipProvider>
                              <Tooltip>
                                <TooltipTrigger asChild>
                                  <Button
                                    variant="outline"
                                    size="sm"
                                    onClick={() => setManagingQuiz(quiz)}
                                  >
                                    <Edit className="h-4 w-4" aria-hidden="true" />
                                  </Button>
                                </TooltipTrigger>
                                <TooltipContent>
                                  <p>Manage questions</p>
                                </TooltipContent>
                              </Tooltip>
                            </TooltipProvider>

                            <TooltipProvider>
                              <Tooltip>
                                <TooltipTrigger asChild>
                                  <Button
                                    variant="outline"
                                    size="sm"
                                    onClick={() => setEditingQuiz(quiz)}
                                  >
                                    <FileText className="h-4 w-4" aria-hidden="true" />
                                  </Button>
                                </TooltipTrigger>
                                <TooltipContent>
                                  <p>Edit quiz settings</p>
                                </TooltipContent>
                              </Tooltip>
                            </TooltipProvider>

                            <TooltipProvider>
                              <Tooltip>
                                <TooltipTrigger asChild>
                                  <Button
                                    variant="outline"
                                    size="sm"
                                    onClick={() => setDeletingQuiz(quiz)}
                                  >
                                    <Trash2 className="h-4 w-4 text-red-600" aria-hidden="true" />
                                  </Button>
                                </TooltipTrigger>
                                <TooltipContent>
                                  <p>Delete quiz</p>
                                </TooltipContent>
                              </Tooltip>
                            </TooltipProvider>
                          </div>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              )}
            </CardContent>
          </Card>

          {/* Enrolled Students (read-only) */}
          <Card>
            <CardHeader>
              <CardTitle>Enrolled Students ({students.length})</CardTitle>
            </CardHeader>
            <CardContent>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Name</TableHead>
                    <TableHead>Email</TableHead>
                    <TableHead>Enrolled Date</TableHead>
                    <TableHead>Progress</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {students.map((student) => (
                    <TableRow key={student.id}>
                      <TableCell className="font-medium">{student.name}</TableCell>
                      <TableCell>{student.email}</TableCell>
                      <TableCell>{student.enrolledDate}</TableCell>
                      <TableCell>
                        <div className="flex items-center gap-2">
                          <div className="flex-1 bg-gray-200 rounded-full h-2 max-w-[100px]">
                            <div
                              className="bg-blue-600 h-2 rounded-full"
                              style={{ width: `${student.progress}%` }}
                              role="progressbar"
                              aria-valuenow={student.progress}
                              aria-valuemin={0}
                              aria-valuemax={100}
                              aria-label={`${student.progress}% progress`}
                            />
                          </div>
                          <span className="text-sm">{student.progress}%</span>
                        </div>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        </div>

        {/* Edit Course Dialog */}
        {editingCourse && (
          <EditCourseDialog
            course={course as any}
            open={editingCourse}
            onOpenChange={setEditingCourse}
            onSave={() => {
              fetchCourseData();
            }}
          />
        )}

        {/* Delete Course Confirmation */}
        <DeleteConfirmDialog
          open={deletingCourse}
          onOpenChange={setDeletingCourse}
          onConfirm={handleDeleteCourse}
          title="Delete Course"
          description={`Are you sure you want to delete "${course.title}"? This action cannot be undone and will remove all lessons and unenroll ${course.totalStudents} students.`}
        />

        {/* Delete Lesson Confirmation */}
        {deletingLesson && (
          <DeleteConfirmDialog
            open={!!deletingLesson}
            onOpenChange={(open) => !open && setDeletingLesson(null)}
            onConfirm={() => handleDeleteLesson(deletingLesson.id)}
            title="Delete Lesson"
            description={`Are you sure you want to delete "${deletingLesson.title}"? This action cannot be undone.`}
          />
        )}

        {/* Add Lesson Dialog */}
        <AddLessonDialog
          courseId={course.id}
          open={addingLesson}
          onOpenChange={setAddingLesson}
          onAdd={handleAddLesson}
          nextOrder={lessons.length + 1}
        />

        {/* Edit Lesson Dialog */}
        <EditLessonDialog
          lesson={editingLesson}
          open={!!editingLesson}
          onOpenChange={(open) => !open && setEditingLesson(null)}
          onSave={handleEditLesson}
        />

        {/* Add Quiz Dialog */}
        <AddQuizDialog
          courseId={course.id}
          open={addingQuiz}
          onOpenChange={setAddingQuiz}
          onAdd={handleAddQuiz}
        />

        {/* Edit Quiz Dialog */}
        <EditQuizDialog
          quiz={editingQuiz}
          open={!!editingQuiz}
          onOpenChange={(open) => !open && setEditingQuiz(null)}
          onSave={handleEditQuiz}
        />

        {/* Delete Quiz Confirmation */}
        {deletingQuiz && (
          <DeleteConfirmDialog
            open={!!deletingQuiz}
            onOpenChange={(open) => !open && setDeletingQuiz(null)}
            onConfirm={() => handleDeleteQuiz(deletingQuiz.id)}
            title="Delete Quiz"
            description={`Are you sure you want to delete "${deletingQuiz.title}"? This action cannot be undone and will remove all questions.`}
          />
        )}

        {/* Quiz Management Dialog */}
        <QuizManagementDialog
          quiz={managingQuiz}
          open={!!managingQuiz}
          onOpenChange={(open) => !open && setManagingQuiz(null)}
        />
      </DashboardLayout>
    </RouteGuard>
  );
}
