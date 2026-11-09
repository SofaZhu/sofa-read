const { app } = require('electron')

app.setPath('userData', process.env.SOFA_TEST_PROFILE)
require('../out/main/index.js')
