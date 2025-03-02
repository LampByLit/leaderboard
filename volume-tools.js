/**
 * Railway Volume Management Tools
 * ===============================
 * 
 * Utility script for managing and debugging Railway volumes
 * 
 * Usage:
 *   node volume-tools.js list      - List all files in the volume
 *   node volume-tools.js check     - Check volume access
 *   node volume-tools.js backup    - Create backup of all data
 * 
 * @module volume-tools
 */

const fs = require('fs').promises;
const path = require('path');

// Configure data directory
const DATA_DIR = path.resolve(process.env.RAILWAY_VOLUME_MOUNT_PATH || path.join(__dirname, 'data'));

// Helper function to create recursive directory if it doesn't exist
async function ensureDir(dirPath) {
    try {
        await fs.mkdir(dirPath, { recursive: true });
        return true;
    } catch (err) {
        console.error(`Error creating directory ${dirPath}:`, err);
        return false;
    }
}

// Helper function to get file size in human-readable format
function formatSize(bytes) {
    const sizes = ['Bytes', 'KB', 'MB', 'GB', 'TB'];
    if (bytes === 0) return '0 Bytes';
    const i = parseInt(Math.floor(Math.log(bytes) / Math.log(1024)));
    return Math.round(bytes / Math.pow(1024, i), 2) + ' ' + sizes[i];
}

// List all files in the volume
async function listFiles() {
    console.log(`\n📂 Listing files in: ${DATA_DIR}`);
    try {
        await fs.access(DATA_DIR);
        
        // List files recursively
        async function listDir(dir, indent = 0) {
            const files = await fs.readdir(dir);
            for (const file of files) {
                const filePath = path.join(dir, file);
                try {
                    const stats = await fs.stat(filePath);
                    const relPath = path.relative(DATA_DIR, filePath);
                    const prefix = '   '.repeat(indent);
                    
                    if (stats.isDirectory()) {
                        console.log(`${prefix}📁 ${relPath}/`);
                        await listDir(filePath, indent + 1);
                    } else {
                        console.log(`${prefix}📄 ${relPath} (${formatSize(stats.size)})`);
                    }
                } catch (err) {
                    console.error(`Error accessing ${filePath}:`, err.message);
                }
            }
        }
        
        await listDir(DATA_DIR);
        console.log('\n✅ Volume listing complete');
    } catch (error) {
        console.error(`\n❌ Volume access ERROR: ${error.message}`);
        console.error(`   Is the RAILWAY_VOLUME_MOUNT_PATH correct? (${process.env.RAILWAY_VOLUME_MOUNT_PATH || 'Not set'})`);
        console.error('   If using Railway: Make sure the volume is attached to this service');
    }
}

// Check volume access
async function checkVolumeAccess() {
    console.log(`\n🔍 Checking volume access for: ${DATA_DIR}`);
    try {
        // Check if the directory exists and is accessible
        await fs.access(DATA_DIR);
        console.log('✅ Volume directory is accessible');
        
        // Check if we can write to the volume
        const testFile = path.join(DATA_DIR, '.volume-test');
        await fs.writeFile(testFile, `Test file created at ${new Date().toISOString()}`);
        console.log('✅ Successfully wrote test file to volume');
        
        // Check if we can read from the volume
        const content = await fs.readFile(testFile, 'utf8');
        console.log('✅ Successfully read test file from volume');
        
        // Clean up test file
        await fs.unlink(testFile);
        console.log('✅ Successfully deleted test file from volume');
        
        // List files in the directory
        const files = await fs.readdir(DATA_DIR);
        console.log(`\n📊 Volume Status: ${files.length} files found`);
        
        // Check for critical files
        const criticalFiles = [
            'books.json',
            'metadata.json',
            'input.json',
            'blacklist.json',
            'brownlist.json',
            'cleanup_log.json'
        ];
        
        for (const file of criticalFiles) {
            try {
                await fs.access(path.join(DATA_DIR, file));
                const stats = await fs.stat(path.join(DATA_DIR, file));
                console.log(`   ✅ ${file} (${formatSize(stats.size)})`);
            } catch (err) {
                console.log(`   ❌ ${file} (Not found or inaccessible)`);
            }
        }
        
        return true;
    } catch (error) {
        console.error(`\n❌ Volume access ERROR: ${error.message}`);
        console.error(`   Is the RAILWAY_VOLUME_MOUNT_PATH correct? (${process.env.RAILWAY_VOLUME_MOUNT_PATH || 'Not set'})`);
        console.error('   If using Railway: Make sure the volume is attached to this service');
        return false;
    }
}

// Create backup of all data
async function createBackup() {
    console.log(`\n💾 Creating backup of all files in: ${DATA_DIR}`);
    try {
        await fs.access(DATA_DIR);
        
        // Create backup directory with timestamp
        const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
        const backupDir = path.join(__dirname, 'backups', `backup-${timestamp}`);
        
        if (await ensureDir(backupDir)) {
            console.log(`✅ Created backup directory: ${backupDir}`);
            
            // Copy all files
            const files = await fs.readdir(DATA_DIR);
            for (const file of files) {
                const sourcePath = path.join(DATA_DIR, file);
                const destPath = path.join(backupDir, file);
                
                try {
                    const stats = await fs.stat(sourcePath);
                    
                    if (!stats.isDirectory()) {
                        await fs.copyFile(sourcePath, destPath);
                        console.log(`   ✅ Backed up: ${file} (${formatSize(stats.size)})`);
                    } else {
                        console.log(`   ⚠️ Skipping directory: ${file}`);
                    }
                } catch (err) {
                    console.error(`   ❌ Error backing up ${file}:`, err.message);
                }
            }
            
            console.log(`\n✅ Backup completed to: ${backupDir}`);
        }
    } catch (error) {
        console.error(`\n❌ Backup ERROR: ${error.message}`);
    }
}

// Handle command-line args
async function main() {
    const command = process.argv[2]?.toLowerCase();
    
    console.log('\n🛠️ Railway Volume Tools');
    console.log(`📂 Volume path: ${DATA_DIR}`);
    
    switch (command) {
        case 'list':
            await listFiles();
            break;
        case 'check':
            await checkVolumeAccess();
            break;
        case 'backup':
            await createBackup();
            break;
        default:
            console.log('\n⚠️ No valid command specified');
            console.log(`
Usage:
  node volume-tools.js list     - List all files in the volume
  node volume-tools.js check    - Check volume access
  node volume-tools.js backup   - Create backup of all data
`);
    }
}

// Run the script
main()
    .then(() => console.log('\n✅ Done'))
    .catch(err => console.error('\n❌ Error:', err.message)); 