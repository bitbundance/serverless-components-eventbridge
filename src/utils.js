const https = require('https')
const AWS = require('@serverless/aws-sdk-extra')
const { equals, not, pick } = require('ramda')
const { readFile } = require('fs-extra')

const agent = new https.Agent({
  keepAlive: true
})

/**
 * Sleep
 * @param {*} wait
 */
const sleep = async (wait) => new Promise((resolve) => setTimeout(() => resolve(), wait))

/**
 * Generate a random ID
 */
const randomId = Math.random()
  .toString(36)
  .substring(6)

/**
 * Get AWS SDK Clients
 * @param {*} credentials
 * @param {*} region
 */
const getClients = (credentials = {}, region) => {
  AWS.config.update({
    httpOptions: {
      agent
    }
  })

  const extras = new AWS.Extras({ credentials, region })
  const iam = new AWS.IAM({ credentials, region })
  const lambda = new AWS.Lambda({ credentials, region })
  const sts = new AWS.STS({ credentials, region })
  const eventbridge = new AWS.EventBridge({ credentials, region })
  return { iam, lambda, extras, sts, eventbridge }
}

/**
 * Prepare inputs
 * @param {*} inputs
 * @param {*} instance
 */
const prepareInputs = (inputs, instance) => {
  return {
    name: inputs.name || instance.state.name || `${instance.name}-${instance.stage}-${randomId}`,
    description:
      inputs.description ||
      `An AWS EventBridge from the AWS EventBridge Serverless Framework Component.  Name: "${instance.name}" Stage: "${instance.stage}"`,
    tagkey: 'Creator',
    tagvalue: 'Bitbundance',
    eventsourcename: inputs.eventsourcename || null,
    region: inputs.region || 'us-east-1'
  }
}

/*
 * Ensure the Meta IAM Role exists
 */
const createOrUpdateMetaRole = async (instance, inputs, clients, serverlessAccountId) => {
  // Create or update Meta Role for monitoring and more, if option is enabled.  It's enabled by default.
  if (inputs.monitoring || typeof inputs.monitoring === 'undefined') {
    console.log('Creating or updating the meta IAM Role...')

    const roleName = `${instance.name}-meta-role`

    const assumeRolePolicyDocument = {
      Version: '2012-10-17',
      Statement: {
        Effect: 'Allow',
        Principal: {
          AWS: `arn:aws:iam::${serverlessAccountId}:root` // Serverless's Components account
        },
        Action: 'sts:AssumeRole'
      }
    }

    // Create a policy that only can access APIGateway and Lambda metrics, logs from CloudWatch...
    const policy = {
      Version: '2012-10-17',
      Statement: [
        {
          Effect: 'Allow',
          Resource: '*',
          Action: [
            'cloudwatch:Describe*',
            'cloudwatch:Get*',
            'cloudwatch:List*',
            'logs:Get*',
            'logs:List*',
            'logs:Describe*',
            'logs:TestMetricFilter',
            'logs:FilterLogEvents'
          ]
          // TODO: Finish this.  Haven't been able to get this to work.  Perhaps there is a missing service (Cloudfront?)
          // Condition: {
          //   StringEquals: {
          //     'cloudwatch:namespace': [
          //       'AWS/ApiGateway',
          //       'AWS/Lambda'
          //     ]
          //   }
          // }
        }
      ]
    }

    const roleDescription = `The Meta Role for the Serverless Framework App: ${instance.name} Stage: ${instance.stage}`

    const result = await clients.extras.deployRole({
      roleName,
      roleDescription,
      policy,
      assumeRolePolicyDocument
    })

    instance.state.metaRoleName = roleName
    instance.state.metaRoleArn = result.roleArn

    console.log(`Meta IAM Role created or updated with ARN ${instance.state.metaRoleArn}`)
  }
}

/**
 * Create a new eventbus
 */
const createEventbus = async (instance, eventbridge, inputs) => {
  const params = {
    Name: inputs.name,
    EventSourceName: inputs.eventsourcename,
    Tags: [
      {
        Key: inputs.tagkey, 
        Value: inputs.tagvalue 
      }
    ]
  }

  try {
    const res = await eventbridge.createEventBus(params).promise()
    return { arn: res.EventBusArn, hash: res.CodeSha256 }
  } catch (e) {
    throw e
  }
}

/**
 * Get EventBridge Function
 * @param {*} eventBridge
 * @param {*} bridgeName
 */
const getEventbus = async (eventbridge, bridgeName) => {
  try {
    const res = await eventbridge
      .describeEventBus({
        Name: bridgeName
      })
      .promise()

    return {
      name: res.Name,
      arn: res.Arn,
      policy: res.Policy
    }
  } catch (e) {
    if (e.code === 'ResourceNotFoundException') {
      return null
    }
    throw e
  }
}

/**
 * Delete eventbus function
 * @param {*} param0
 */
const deleteEventbus = async (eventbridge, bridgename) => {
  try {
    const params = { Name: bridgename }
    await eventbridge.deleteEventBus(params).promise()
  } catch (error) {
    console.log(error)
    if (error.code !== 'ResourceNotFoundException') {
      throw error
    }
  }
}

/**
 * Get metrics from cloudwatch
 * @param {*} clients
 * @param {*} rangeStart MUST be a moment() object
 * @param {*} rangeEnd MUST be a moment() object
 */
const getMetrics = async (region, metaRoleArn, functionName, rangeStart, rangeEnd) => {
  /**
   * Create AWS STS Token via the meta role that is deployed with the Express Component
   */

  // Assume Role
  const assumeParams = {}
  assumeParams.RoleSessionName = `session${Date.now()}`
  assumeParams.RoleArn = metaRoleArn
  assumeParams.DurationSeconds = 900

  const sts = new AWS.STS({ region })
  const resAssume = await sts.assumeRole(assumeParams).promise()

  const roleCreds = {}
  roleCreds.accessKeyId = resAssume.Credentials.AccessKeyId
  roleCreds.secretAccessKey = resAssume.Credentials.SecretAccessKey
  roleCreds.sessionToken = resAssume.Credentials.SessionToken

  /**
   * Instantiate a new Extras instance w/ the temporary credentials
   */

  const extras = new AWS.Extras({
    credentials: roleCreds,
    region
  })

  const resources = [
    {
      type: 'aws_lambda',
      functionName
    }
  ]

  return await extras.getMetrics({
    rangeStart,
    rangeEnd,
    resources
  })
}

/**
 * Exports
 */
module.exports = {
  prepareInputs,
  getClients,
  createOrUpdateMetaRole,
  createEventbus,
  getEventbus,
  deleteEventbus,
  getMetrics
}
