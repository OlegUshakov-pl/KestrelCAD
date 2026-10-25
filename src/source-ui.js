/* Original-source and explicit compatibility-export commands. */
(function (root) {
    'use strict';
    const K = root.Kestrel, S = K.SourceDocument, U = K.UI;
    const esc = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
    const commands = [
        ['source-info', 'Original drawing / fidelity', 'SOURCEINFO', 'properties'],
        ['source-original', 'Download original drawing', 'SOURCEORIGINAL', 'download'],
        ['source-preserved', 'Save preserving source DXF', 'DXFSAVE', 'save'],
        ['source-compatible', 'Compatibility DXF export', 'DXFEXPORT', 'export'],
        ['source-binary', 'Binary compatibility DXF', 'DXFBINARY', 'export']
    ];
    for (const [id, label, alias, icon] of commands) U.commands.push({ id, label, alias, icon, description: label });
    U.groups.Exchange = [{ name: 'Original and edited source', large: ['source-preserved', 'source-original'], columns: [['source-info']] },
        { name: 'Regenerate supported objects', large: ['source-compatible', 'source-binary'], columns: [['export-dwg', 'export-svg']] }];
    K.installSourceUI = function (App) {
        const run = App.prototype.run, originalExport = App.prototype.exportDXF;
        // The explicit compatibility path regenerates supported content; it is
        // offered directly by DXFEXPORT/DXFBINARY and as the fallback after a
        // refused guarded save.
        App.prototype.compatibilityExport = function (binary = false, refusalNote = '') {
            const note = binary ? '<div class="dialog-note warning"><strong>Binary staleness</strong>Unlike DXFSAVE, binary encoding rewrites the whole file; unknown record flavors are re-encoded rather than byte-preserved.</div>' : '<div class="dialog-note warning"><strong>This regenerates supported content only.</strong>Unknown source objects, application metadata and original layout content can be omitted. Save a native project to retain your original, or use DXFSAVE for guarded edits.</div>';
            this.dialog({ title: 'Compatibility DXF export',
                html: `${refusalNote ? `<div class="dialog-note warning"><strong>${esc(refusalNote)}</strong>Finish with a regenerated export, or cancel and keep editing (a native .kcad save retains the original archive).</div>` : ''}${note}<label class="form-check"><input type="checkbox" name="acknowledge" required>I understand that this is not a lossless original-file export.</label>`,
                submit: 'Export supported content',
                onSubmit: async f => {
                    if (!f.acknowledge) throw Error('Acknowledge the compatibility export limitations.');
                    const data = this.doc.serialize({ includeSource: false }), name = this.filename('dxf');
                    const output = await this.io(binary ? 'binary-dxf' : 'write-dxf', data);
                    const saved = await this.writeOut(output, name, 'application/dxf');
                    if (!saved) return;
                    this.toast((binary ? 'Binary' : 'ASCII') + ' compatibility export saved: supported geometry only.');
                } });
        };
        // A guarded save refused by the source exporter (unsupported mesh edits,
        // structural source data…) opens an explicit choice instead of an
        // unexplained error dialog.
        App.prototype.sourceRefusalDialog = function (reason) {
            this.log('DXF', 'Source-preserving export refused: ' + reason);
            this.dialog({ title: 'Source-preserving save refused',
                html: `<div class="dialog-note warning"><strong>${esc(reason)}</strong>Guarded edits can only rewrite the simple entity records they understand; the refused change would corrupt or silently drop retained source data.</div><div class="dialog-note"><table class="report-table"><tr><td>Compatibility export</td><td>Regenerates the supported geometry subset into a fresh DXF.</td></tr><tr><td>Cancel</td><td>Keep editing, or save a native .kcad project (the original source archive stays attached).</td></tr></table></div>`,
                submit: 'Compatibility export…',
                onSubmit: () => { this.compatibilityExport(false, reason); return false; } });
        };
        App.prototype.exportDXF = async function () {
            if (!this.doc.sourceDocument) return originalExport.call(this);
            const data = this.doc.serialize(), name = this.filename('dxf');
            this.log('DXF', 'Applying guarded edits to retained source records…');
            let output;
            try {
                output = await this.io('preserve-dxf', data);
            }
            catch (error) {
                this.sourceRefusalDialog(error.message);
                return;
            }
            const saved = await this.writeOut(output.bytes, name, 'application/dxf');
            if (!saved) return;
            this.log('DXF', output.report.unchanged ? 'Original DXF bytes restored without regeneration.' : `${output.report.changed} records changed, ${output.report.added} added, ${output.report.deleted} deleted; remaining source bytes retained.`);
            for (const message of output.report.warnings) this.log('Fidelity', message);
            this.toast(saved.fallback ? 'Edited DXF downloaded (browser download used).' : output.report.unchanged ? 'Original DXF restored.' : 'Edited DXF saved with remaining source records retained.');
        };
        App.prototype.run = async function (id, ...args) {
            if (!commands.some(c => c[0] === id)) return run.call(this, id, ...args);
            try {
                if (id === 'source-preserved') { if (!this.doc.sourceDocument) throw Error('No original source is attached to this drawing. Use DXFEXPORT.'); return await this.exportDXF(); }
                if (id === 'source-original') {
                    const source = this.doc.sourceDocument; if (!source) throw Error('This drawing has no original imported file.');
                    const saved = await this.writeOut(S.original(this.doc), source.name); if (!saved) return;
                    this.toast(saved.fallback ? 'Original file downloaded to the browser download folder.' : 'Original file saved. It does not include your subsequent edits.'); return;
                }
                if (id === 'source-info') {
                    const info = S.info(this.doc);
                    this.dialog({ title: 'Original drawing and fidelity', closeOnly: true, wide: true,
                        html: info ? `<table class="report-table"><tr><td>Original file</td><td>${esc(info.name)}</td></tr><tr><td>Original format</td><td>${info.format.toUpperCase()}</td></tr><tr><td>Original bytes</td><td>${info.originalBytes.toLocaleString()}</td></tr><tr><td>DXF source</td><td>${esc(info.version)} · ${info.binary ? 'Binary' : 'ASCII'} · ${esc(info.encoding)}</td></tr><tr><td>Retained records</td><td>${info.records}</td></tr><tr><td>Editing state</td><td>${info.unchanged ? 'Unchanged source geometry' : 'Edited native drawing'}</td></tr></table><p>Original file data and the import baseline are saved in the native project, once, outside undo snapshots. SOURCEORIGINAL always returns the unedited original.</p><p>DXFSAVE preserves unknown sections, objects, metadata and unedited records. It supports guarded simple-entity edits, additions, checked deletions and existing-layer properties. It refuses unsupported edits instead of dropping data. Retained proxy/reactor data is not recomputed or certified. DWG original bytes are not a modified DWG export.</p>` : '<p>This is a native drawing with no imported original. Normal export writes the supported entity subset.</p>' }); return;
                }
                const binary = id === 'source-binary';
                if (!this.doc.sourceDocument) {
                    const data = this.doc.serialize({ includeSource: false });
                    const output = await this.io(binary ? 'binary-dxf' : 'write-dxf', data);
                    const saved = await this.writeOut(output, this.filename('dxf'), 'application/dxf');
                    if (saved) this.toast((binary ? 'Binary' : 'ASCII') + ' compatibility export saved: supported geometry only.');
                    return;
                }
                this.compatibilityExport(binary);
            } catch (error) { this.fail(error); }
        };
    };
})(window);
