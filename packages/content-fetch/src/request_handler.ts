import { Storage } from '@google-cloud/storage'
import { fetchContent } from '@omnivore/puppeteer-parse'
import crypto from 'crypto'
import { RequestHandler } from 'express'
import { analytics } from './analytics'
import { queueSavePageJob } from './job'

interface User {
  id: string
  folder?: string
}

interface RequestBody {
  url: string
  userId?: string
  saveRequestId: string
  state?: string
  labels?: string[]
  source?: string
  taskId?: string
  locale?: string
  timezone?: string
  rssFeedUrl?: string
  savedAt?: string
  publishedAt?: string
  folder?: string
  users?: User[]
  priority: 'high' | 'low'
}

interface LogRecord {
  url: string
  articleSavingRequestId: string
  labels: {
    source: string
  }
  state?: string
  labelsToAdd?: string[]
  taskId?: string
  locale?: string
  timezone?: string
  rssFeedUrl?: string
  savedAt?: string
  publishedAt?: string
  folder?: string
  users?: User[]
  error?: string
  totalTime?: number
}

const storage = process.env.GCS_UPLOAD_SA_KEY_FILE_PATH
  ? new Storage({ keyFilename: process.env.GCS_UPLOAD_SA_KEY_FILE_PATH })
  : new Storage()
const bucketName = process.env.GCS_UPLOAD_BUCKET || 'omnivore-files'

export const uploadToBucket = async (filename: string, data: string) => {
  await storage
    .bucket(bucketName)
    .file(`originalContent/${filename}`)
    .save(data, { public: false, timeout: 30000 })
}

const hash = (content: string) =>
  crypto.createHash('md5').update(content).digest('hex')

export const contentFetchRequestHandler: RequestHandler = async (req, res) => {
  const functionStartTime = Date.now()

  const body = <RequestBody>req.body

  // users is used when saving article for multiple users
  let users = body.users || []
  const userId = body.userId
  // userId is used when saving article for a single user
  if (userId) {
    users = [
      {
        id: userId,
        folder: body.folder,
      },
    ]
  }
  const articleSavingRequestId = body.saveRequestId
  const state = body.state
  const labels = body.labels
  const source = body.source || 'puppeteer-parse'
  const taskId = body.taskId // taskId is used to update import status
  const url = body.url
  const locale = body.locale
  const timezone = body.timezone
  const rssFeedUrl = body.rssFeedUrl
  const savedAt = body.savedAt
  const publishedAt = body.publishedAt
  const priority = body.priority

  const logRecord: LogRecord = {
    url,
    articleSavingRequestId,
    labels: {
      source,
    },
    state,
    labelsToAdd: labels,
    taskId: taskId,
    locale,
    timezone,
    rssFeedUrl,
    savedAt,
    publishedAt,
    users,
  }

  console.log(`Article parsing request`, logRecord)

  try {
    const fetchResult = await fetchContent(url, locale, timezone)
    const finalUrl = fetchResult.finalUrl
    let contentHash: string | undefined

    const content = fetchResult.content
    if (content) {
      // hash content to use as key
      contentHash = hash(content)
      await uploadToBucket(contentHash, content)
      console.log('content uploaded to bucket', contentHash)
    }

    const savePageJobs = users.map((user) => ({
      userId: user.id,
      data: {
        userId: user.id,
        url,
        finalUrl,
        articleSavingRequestId,
        state,
        labels,
        source,
        folder: user.folder,
        rssFeedUrl,
        savedAt,
        publishedAt,
        taskId,
        title: fetchResult.title,
        contentType: fetchResult.contentType,
        contentHash,
      },
      isRss: !!rssFeedUrl,
      isImport: !!taskId,
      priority,
    }))

    const jobs = await queueSavePageJob(savePageJobs)
    console.log('save-page jobs queued', jobs.length)
  } catch (error) {
    if (error instanceof Error) {
      logRecord.error = error.message
    } else {
      logRecord.error = 'unknown error'
    }

    return res.sendStatus(500)
  } finally {
    logRecord.totalTime = Date.now() - functionStartTime
    console.log(`parse-page result`, logRecord)

    // capture events
    analytics.capture(
      users.map((user) => user.id),
      {
        result: logRecord.error ? 'failure' : 'success',
        properties: {
          url,
          totalTime: logRecord.totalTime,
        },
      }
    )
  }

  res.sendStatus(200)
}
