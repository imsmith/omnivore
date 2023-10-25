import { expect } from 'chai'
import 'mocha'
import { In } from 'typeorm'
import { StatusType } from '../../src/entity/user'
import {
  createUsers,
  deleteUsers,
  findUsersById,
} from '../../src/services/user'
import { request } from '../util'

describe('User Service Router', () => {
  const token = process.env.PUBSUB_VERIFICATION_TOKEN || ''

  describe('cleanup', () => {
    let toDeleteUserIds: string[] = []

    before(async () => {
      // create test users
      const users = await createUsers([
        {
          name: 'user_1',
          email: 'user_1@omnivore.app',
          status: StatusType.Deleted,
          updatedAt: new Date(Date.now() - 1000 * 60 * 60 * 24 * 2), // 2 days ago
        },
        {
          name: 'user_2',
          email: 'user_2@omnivore.app',
          status: StatusType.Deleted,
          updatedAt: new Date(Date.now() - 1000 * 60 * 60 * 24 * 2), // 2 days ago
        },
      ])
      toDeleteUserIds = users.map((u) => u.id)
    })

    after(async () => {
      // delete test users
      await deleteUsers({ id: In(toDeleteUserIds) })
    })

    it('deletes soft deleted users a day ago', async () => {
      const data = {
        message: {
          data: Buffer.from(
            JSON.stringify({ subDays: 1 }) // 1 day ago
          ).toString('base64'),
          publishTime: new Date().toISOString(),
        },
      }

      await request
        .post('/api/user/cleanup?token=' + token)
        .send(data)
        .expect(200)

      const deletedUsers = await findUsersById(toDeleteUserIds)
      expect(deletedUsers.length).to.equal(0)
    })
  })
})
