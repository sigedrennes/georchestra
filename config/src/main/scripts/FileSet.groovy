class FileSet {

	String project
	private def sources = []

	def each(Closure c) {
		sources.each {
			it.eachFile(c) 
		}
	}
	
	private def resolve(def source) {
		def s
		
		if (source instanceof File) {
			s = source
		} else {
			s = new File(source.toString())
		}
		def outFile
		if(project != null) {
			outFile = new File(Parameters.get.basedirFile.parent+("/$project/$s").replace('/', File.separator))
		} else {
			outFile = s
		}
		
		if (!outFile.exists()) {
			throw new AssertionError("$outFile does not exist. Check definition of FileSet")
		}
		
		return outFile

	}
	FileSet descendants(def source, Closure filter = null, Closure sort = null) {
		dir (source, true, filter, sort)
	}

	FileSet children(def source, Closure filter = null, Closure sort = null) {
		dir (source, false, filter, sort)
	}
	private FileSet dir(def source, Boolean recurse = true, Closure filter = null, Closure sort = null) {
		if(filter == null) {
			filter = { f -> true }
		}
		if (recurse == null) {
			recurse = true
		}
		def processDir = { c ->
			if (recurse) {
				resolve(source).eachFileRecurse { file ->
					if (filter(file)) {
						c(file)
					}
				}
			} else {
				resolve(source).eachFile { file ->
					if (filter(file)) {
						c(file)
					}
				}		
			}
		}
		sources << [
			eachFile: { c ->
				if(sort != null) {
					def files = new TreeSet([compare: { o1, o2 ->
							return sort(o1,o2)
						}] as Comparator)
					
					processDir {files.add(it)}
					
					files.each { c(it) }
				} else {
					processDir (c)
				}
			}
		]
		return this
	}

	FileSet file (def source) {
		sources << [
			eachFile: { c ->
				c(resolve(source))
			}
		]
		return this
	}



}